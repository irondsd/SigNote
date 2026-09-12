'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { v7 as uuidv7 } from 'uuid';

import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { deriveOtpVaultKey } from '@/lib/crypto';
import { compareAuthRecords, nextAuthPosition, renumberPositions } from '@/lib/otp/order';
import { decryptOtpRecord, encryptOtpRecord, type OtpSecrets } from '@/lib/otp/record';
import {
  announceVaultRemoval,
  clearLastActiveUserId,
  getLastActiveUserId,
  listVaultUserIds,
  loadRecords,
  loadVault,
  removeVault,
  replaceRecords,
  requestPersistentStorage,
  saveVault,
  updateVault,
  type OtpCachedRecord,
} from '@/lib/otpStore';
import { conflictRow, handleOtpUnauthorized, otpTrpcClient } from '@/lib/otpTrpcClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export type OtpPhase =
  /** Resolving the session and any local vault. Render nothing decisive yet. */
  | 'loading'
  /** No local vault and no session: there is nothing to show and nothing to enroll. */
  | 'signed-out'
  /** A session, but this device is not enrolled — show the trust prompt. */
  | 'not-enrolled'
  /** A vault key is in hand. Codes generate, with or without a session. */
  | 'ready';

export type OtpSyncState =
  | 'idle'
  /** A request is in flight. */
  | 'syncing'
  /** Last sync succeeded; writes are allowed. */
  | 'online'
  /** Network failed. Codes keep generating; writes are disabled. */
  | 'offline'
  /** Session termination is being handled. */
  | 'signed-out'
  | 'error';

export type AuthRecord = {
  id: string;
  revision: number;
  position: number;
  archived: boolean;
  color: NoteColor | null;
  pattern: NotePattern | null;
  updatedAt: string;
  /** Null when this record could not be decrypted with the current key. */
  secrets: OtpSecrets | null;
};

export type NewAuthInput = {
  secrets: OtpSecrets;
  color?: NoteColor | null;
  pattern?: NotePattern | null;
};

type OtpVaultValue = {
  phase: OtpPhase;
  syncState: OtpSyncState;
  /** True when the key is persisted on this device; false in memory-only mode. */
  trusted: boolean;
  /** Which account's vault is on screen. */
  vaultUserId: string | null;
  records: AuthRecord[];
  /** Clock correction. Codes are generated from `Date.now() + this`. */
  serverTimeOffsetMs: number;
  /** True when the device clock is more than half a period out. */
  clockSuspect: boolean;
  /** Vaults belonging to *other* accounts, offered for removal on sign-in. */
  strandedUserIds: string[];
  /** False while `phase` is 'ready' but no record snapshot has arrived yet —
   *  the list is empty because nothing has been fetched, not because the vault
   *  is. Enrollment is the one path that gets there, so the page waits for the
   *  first sync instead of flashing the empty state. */
  hydrated: boolean;

  enroll: (mek: CryptoKey, options: { trust: boolean }) => Promise<void>;
  forget: () => Promise<void>;
  forgetUser: (userId: string) => Promise<void>;
  sync: () => Promise<void>;

  create: (input: NewAuthInput) => Promise<void>;
  updateSecrets: (id: string, secrets: OtpSecrets) => Promise<void>;
  setStyle: (id: string, patch: { color?: NoteColor | null; pattern?: NotePattern | null }) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  setPosition: (id: string, position: number) => Promise<void>;
  /** Rewrites every position from the given order. See `renumber`. */
  renumber: (ordered: AuthRecord[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const OtpVaultContext = createContext<OtpVaultValue | null>(null);

export function useOtpVault(): OtpVaultValue {
  const ctx = useContext(OtpVaultContext);
  if (!ctx) throw new Error('useOtpVault must be used within OtpVaultProvider');
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHANNEL = 'signote-otp';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

type WireRecord = {
  id: string;
  payload: { alg: 'A256GCM'; iv: string; ciphertext: string } | null;
  payloadVersion: number;
  position: number;
  revision: number;
  archived: boolean;
  color: NoteColor | null;
  pattern: NotePattern | null;
  updatedAt: string;
  deletedAt: string | null;
};

const toCached = (userId: string, r: WireRecord): OtpCachedRecord => ({ ...r, userId });

/** Tombstones stay in the cache so a later snapshot can still reconcile them,
 *  but they are never part of the list the UI renders. */
const isLive = (r: OtpCachedRecord) => r.deletedAt === null && r.payload !== null;

async function decryptAll(key: CryptoKey, cached: OtpCachedRecord[]): Promise<AuthRecord[]> {
  const live = cached.filter(isLive);
  const out = await Promise.all(
    live.map(async (r): Promise<AuthRecord> => {
      let secrets: OtpSecrets | null = null;
      try {
        secrets = await decryptOtpRecord(key, r.id, r.payload!);
      } catch {
        // Wrong key, or a payload bound to a different id. Shown as an
        // unreadable card rather than silently vanishing.
      }
      return {
        id: r.id,
        revision: r.revision,
        position: r.position,
        archived: r.archived,
        color: (r.color as NoteColor | null) ?? null,
        pattern: (r.pattern as NotePattern | null) ?? null,
        updatedAt: r.updatedAt,
        secrets,
      };
    }),
  );
  return out.sort(compareAuthRecords);
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function OtpVaultProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  const sessionUserId = session?.user?.id ?? null;
  const sessionKey = `${sessionStatus}:${sessionUserId ?? ''}`;

  const [phase, setPhase] = useState<OtpPhase>('loading');
  /** Which session identity the visible state was resolved for. Until these
   *  match, old plaintext is hidden synchronously during an account change. */
  const [resolvedSessionKey, setResolvedSessionKey] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<OtpSyncState>('idle');
  const [trusted, setTrusted] = useState(false);
  const [vaultUserId, setVaultUserId] = useState<string | null>(null);
  const [cached, setCached] = useState<OtpCachedRecord[]>([]);
  const [records, setRecords] = useState<AuthRecord[]>([]);
  const [serverTimeOffsetMs, setOffset] = useState(0);
  const [strandedUserIds, setStranded] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // The key never enters React state: it is not renderable, and keeping it in a
  // ref avoids it being captured by stale closures across a re-render.
  const keyRef = useRef<CryptoKey | null>(null);
  const profileIdRef = useRef<string | null>(null);
  /** The encryption generation this key was derived under; null for an
   *  enrollment made before the field existed. See `OtpVaultEntry`. */
  const generationRef = useRef<number | null>(null);
  const trustedRef = useRef(false);
  const vaultUserIdRef = useRef<string | null>(vaultUserId);
  const sessionUserIdRef = useRef<string | null>(sessionUserId);
  const syncGenerationRef = useRef(0);
  vaultUserIdRef.current = vaultUserId;
  sessionUserIdRef.current = sessionUserId;

  const setKey = useCallback((key: CryptoKey | null, isTrusted: boolean) => {
    keyRef.current = key;
    trustedRef.current = isTrusted;
    setTrusted(isTrusted);
  }, []);

  /** Re-derives the rendered list from the encrypted cache. */
  const refresh = useCallback(async (next: OtpCachedRecord[]) => {
    const userId = vaultUserIdRef.current;
    const key = keyRef.current;
    const decrypted = key ? await decryptAll(key, next) : [];
    // Account/key changes are allowed while AES operations are in flight. A
    // result belongs only to the exact vault that started the work.
    if (userId === vaultUserIdRef.current && key === keyRef.current) {
      setCached(next);
      setRecords(decrypted);
    }
  }, []);

  // ── Local resolution ───────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    let cancelled = false;
    const resolvingSessionKey = sessionKey;

    (async () => {
      // IndexedDB is per origin, not per account. With a session the answer is
      // simply "this user"; without one, fall back to the last account shown on
      // this browser, or the only vault present.
      const all = await listVaultUserIds();
      let target = sessionUserId;
      if (!target) {
        const last = getLastActiveUserId();
        target = last && all.includes(last) ? last : all.length === 1 ? all[0] : null;
      }
      if (cancelled) return;

      setStranded(target ? all.filter((id) => id !== target) : []);

      if (!target) {
        setKey(null, false);
        profileIdRef.current = null;
        generationRef.current = null;
        setVaultUserId(null);
        setCached([]);
        setRecords([]);
        setOffset(0);
        setSyncState('signed-out');
        setPhase(sessionUserId ? 'not-enrolled' : 'signed-out');
        setHydrated(true);
        setResolvedSessionKey(resolvingSessionKey);
        return;
      }

      setVaultUserId(target);
      const vault = await loadVault(target);
      if (cancelled) return;

      if (!vault) {
        setKey(null, false);
        profileIdRef.current = null;
        generationRef.current = null;
        setCached([]);
        setRecords([]);
        setOffset(0);
        setSyncState('idle');
        setPhase(sessionUserId ? 'not-enrolled' : 'signed-out');
        setHydrated(true);
        setResolvedSessionKey(resolvingSessionKey);
        return;
      }

      const next = await loadRecords(target);
      const decrypted = await decryptAll(vault.key, next);
      if (cancelled) return;

      setKey(vault.key, true);
      profileIdRef.current = vault.profileId;
      generationRef.current = vault.generation ?? null;
      setOffset(vault.serverTimeOffsetMs);
      setCached(next);
      setRecords(decrypted);
      setSyncState(sessionStatus === 'authenticated' ? 'idle' : 'signed-out');
      setPhase('ready');
      setHydrated(true);
      setResolvedSessionKey(resolvingSessionKey);
    })();

    return () => {
      cancelled = true;
    };
    // A memory-only session must survive re-renders; only a real session change
    // re-resolves the vault.
  }, [sessionStatus, sessionUserId, sessionKey, setKey]);

  // ── Cross-tab removal ──────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<{ type: string; userId?: string }>) => {
      // Deleting the database does not disarm a tab that already holds the key
      // in memory — it has to be told.
      if (e.data?.type === 'vault-removed' && e.data.userId === vaultUserId) {
        setKey(null, false);
        setRecords([]);
        setCached([]);
        setPhase(sessionUserId ? 'not-enrolled' : 'signed-out');
      }
    };
    return () => channel.close();
  }, [vaultUserId, sessionUserId, setKey]);

  // ── Sync ───────────────────────────────────────────────────────────────────

  const sync = useCallback(async () => {
    const userId = vaultUserId;
    const key = keyRef.current;
    const profileId = profileIdRef.current;
    const persist = trustedRef.current;
    if (!userId || !key || sessionStatus !== 'authenticated' || sessionUserIdRef.current !== userId) return;

    const generation = ++syncGenerationRef.current;
    const isCurrent = () =>
      generation === syncGenerationRef.current &&
      sessionUserIdRef.current === userId &&
      vaultUserIdRef.current === userId &&
      keyRef.current === key;

    setSyncState('syncing');
    try {
      const [{ records: wire, serverTime }, profile] = await Promise.all([
        otpTrpcClient.otp.list.query() as Promise<{ records: WireRecord[]; serverTime: number }>,
        otpTrpcClient.encryption.profile.query() as Promise<{
          exists: boolean;
          profileId?: string;
          generation?: number;
        }>,
      ]);

      // Two remote kill switches, and they answer different questions. A new
      // profile id means the encryption profile was *reset* — a different
      // account vault entirely. A new generation means the same profile's keys
      // were *rotated*, which deliberately keeps the id stable: without this
      // second check the device would see a matching id, accept
      // new-generation ciphertext, and decrypt none of it while still
      // presenting itself as enrolled.
      if (!isCurrent()) return;

      const enrolledGeneration = generationRef.current;
      const reported = profile.generation;
      // An enrollment predating the field is adopted only at generation zero,
      // which was true of every one of them when this shipped. Anything else
      // is an enrollment whose generation cannot be established, and an
      // unverifiable key is treated as a dead one.
      const generationStale =
        typeof reported !== 'number' ||
        (enrolledGeneration === null ? reported !== 0 : reported !== enrolledGeneration);

      if (!profile.exists || !profileId || profile.profileId !== profileId || generationStale) {
        try {
          await removeVault(userId);
        } finally {
          announceVaultRemoval(userId);
          if (isCurrent()) {
            setKey(null, false);
            profileIdRef.current = null;
            generationRef.current = null;
            setCached([]);
            // Codes on screen were generated from a seed this device can no
            // longer read. Clear them before anything renders the new snapshot.
            setRecords([]);
            setPhase('not-enrolled');
            setHydrated(true);
            setSyncState('online');
          }
        }
        return;
      }

      // A legacy enrollment just proved itself against generation zero; record
      // it so the next rotation is caught by the comparison above rather than
      // by the legacy branch again.
      if (enrolledGeneration === null) {
        generationRef.current = reported;
        if (persist) await updateVault(userId, { generation: reported });
      }

      const offset = serverTime - Date.now();
      const next = wire.map((r) => toCached(userId, r));
      if (persist) {
        await replaceRecords(userId, next);
        await updateVault(userId, { serverTimeOffsetMs: offset });
      }
      if (!isCurrent()) return;
      setOffset(offset);
      await refresh(next);
      if (!isCurrent()) return;
      setHydrated(true);
      setSyncState('online');
    } catch (err) {
      if (!isCurrent()) return;
      // The snapshot is as good as it is going to get; show the list (or the
      // empty state) alongside the offline banner rather than spinning on.
      setHydrated(true);
      if (await handleOtpUnauthorized(err)) {
        setSyncState('signed-out');
      } else {
        setSyncState(navigator.onLine ? 'error' : 'offline');
      }
    }
  }, [vaultUserId, sessionStatus, refresh, setKey]);

  useEffect(() => {
    if (phase === 'ready' && sessionStatus === 'authenticated') void sync();
  }, [phase, sessionStatus, sync]);

  useEffect(() => {
    if (phase === 'ready' && sessionStatus === 'unauthenticated') setSyncState('signed-out');
  }, [phase, sessionStatus]);

  useEffect(() => {
    if (phase !== 'ready' || sessionStatus !== 'authenticated') return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    const timer = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [phase, sessionStatus, sync]);

  /**
   * Losing the network has to mark sync stale immediately. Waiting for the next
   * request to fail would leave `syncState` reading 'online' for as long as
   * nothing happened to be in flight — long enough for the user to open the add
   * dialog, fill it in and only then discover the write cannot land.
   */
  useEffect(() => {
    const goOffline = () => setSyncState((state) => (state === 'signed-out' ? state : 'offline'));
    const goOnline = () => {
      if (phase === 'ready' && sessionStatus === 'authenticated') void sync();
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    if (!navigator.onLine) goOffline();
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [phase, sessionStatus, sync]);

  // ── Enrollment ─────────────────────────────────────────────────────────────

  const enroll = useCallback(
    async (mek: CryptoKey, { trust }: { trust: boolean }) => {
      if (!sessionUserId) throw new Error('Sign in to set up the authenticator');

      const key = await deriveOtpVaultKey(mek);
      const profile = (await otpTrpcClient.encryption.profile.query()) as {
        exists: boolean;
        profileId?: string;
        generation?: number;
      };
      const profileId = profile.profileId ?? '';
      // The key was derived from a MEK the caller had to unlock to obtain, so
      // the generation the server reports now is the one it belongs to.
      const generation = profile.generation ?? 0;

      if (trust) {
        try {
          await saveVault({
            userId: sessionUserId,
            key,
            profileId,
            generation,
            deviceId: uuidv7(),
            enrolledAt: Date.now(),
            serverTimeOffsetMs: 0,
          });
          await requestPersistentStorage();
        } catch {
          // Storing a non-extractable CryptoKey is the only acceptable way to
          // persist it; if the browser refuses, fall back to memory-only rather
          // than writing raw key bytes.
          throw new Error('This browser will not store the key securely. Continue without trusting this device.');
        }
      }

      profileIdRef.current = profileId;
      generationRef.current = generation;
      setKey(key, trust);
      setVaultUserId(sessionUserId);
      // No records have been fetched for this key yet. See `hydrated`.
      setHydrated(false);
      setPhase('ready');
    },
    [sessionUserId, setKey],
  );

  const forgetUser = useCallback(
    async (userId: string) => {
      await removeVault(userId);
      announceVaultRemoval(userId);
      setStranded((prev) => prev.filter((id) => id !== userId));
      if (userId === vaultUserId) {
        setKey(null, false);
        profileIdRef.current = null;
        generationRef.current = null;
        setCached([]);
        setRecords([]);
        setPhase(sessionUserId ? 'not-enrolled' : 'signed-out');
      }
    },
    [vaultUserId, sessionUserId, setKey],
  );

  const forget = useCallback(async () => {
    if (vaultUserId) await forgetUser(vaultUserId);
    clearLastActiveUserId();
  }, [vaultUserId, forgetUser]);

  useEffect(() => {
    if (phase === 'ready' && vaultUserId) {
      // Remembered so an offline visit with no session knows whose vault to open.
      import('@/lib/otpStore').then((m) => m.setLastActiveUserId(vaultUserId));
    }
  }, [phase, vaultUserId]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Every write goes to the server first and the local cache second. v1 queues
   * nothing: offline the authenticator is read-only, so there is no local write
   * that could later disagree with the server.
   */
  const applyRow = useCallback(
    async (row: WireRecord) => {
      const userId = vaultUserId;
      if (!userId) return;
      const key = keyRef.current;
      const persist = trustedRef.current;
      // In place. Filtering the record out and pushing it back on the end
      // reorders the array, and with a stable sort that moved the card to the
      // end of any group sharing its position — which is what made recolouring
      // a card appear to send it to the bottom of the list.
      const updated = toCached(userId, row);
      const next = cached.some((r) => r.id === row.id)
        ? cached.map((r) => (r.id === row.id ? updated : r))
        : [...cached, updated];
      if (persist) await replaceRecords(userId, next);
      if (vaultUserIdRef.current !== userId || keyRef.current !== key) return;
      await refresh(next);
    },
    [cached, vaultUserId, refresh],
  );

  const create = useCallback(
    async ({ secrets, color, pattern }: NewAuthInput) => {
      const key = keyRef.current;
      if (!key) throw new Error('The authenticator is not unlocked');

      // The id is generated here so the payload can be sealed under it before it
      // is ever sent, which is what makes the AAD binding possible.
      const id = uuidv7();
      const payload = await encryptOtpRecord(key, id, secrets);
      const position = nextAuthPosition(records);

      const row = (await otpTrpcClient.otp.create.mutate({
        id,
        payload,
        payloadVersion: secrets.v,
        position,
        ...(color !== undefined ? { color } : {}),
        ...(pattern !== undefined ? { pattern } : {}),
      })) as WireRecord;
      await applyRow(row);
    },
    [records, applyRow],
  );

  /** Re-reads the row on a conflict so a losing write self-heals instead of
   *  leaving the card showing something the server does not have. */
  const mutate = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const current = cached.find((r) => r.id === id);
      if (!current) throw new Error('That record is no longer here');
      try {
        await applyRow(
          (await otpTrpcClient.otp.update.mutate({
            id,
            expectedRevision: current.revision,
            ...patch,
          })) as WireRecord,
        );
      } catch (err) {
        const conflict = conflictRow<WireRecord>(err);
        if (conflict) await applyRow(conflict);
        throw err;
      }
    },
    [cached, applyRow],
  );

  const updateSecrets = useCallback(
    async (id: string, secrets: OtpSecrets) => {
      const key = keyRef.current;
      if (!key) throw new Error('The authenticator is not unlocked');
      await mutate(id, { payload: await encryptOtpRecord(key, id, secrets) });
    },
    [mutate],
  );

  const setStyle = useCallback(
    (id: string, patch: { color?: NoteColor | null; pattern?: NotePattern | null }) => mutate(id, patch),
    [mutate],
  );
  const setArchived = useCallback((id: string, archived: boolean) => mutate(id, { archived }), [mutate]);
  const setPosition = useCallback((id: string, position: number) => mutate(id, { position }), [mutate]);

  /**
   * Rewrites every position with fresh, evenly spaced values, in the order
   * given. The escape hatch for a list whose gaps have been bisected away (or
   * collapsed onto each other by the inverted arithmetic this used to use):
   * once two neighbours share a position, no midpoint can separate them.
   */
  const renumber = useCallback(
    async (ordered: AuthRecord[]) => {
      const userId = vaultUserId;
      if (!userId) return;
      const key = keyRef.current;
      const persist = trustedRef.current;
      const items = renumberPositions(ordered);
      const { records: wire } = (await otpTrpcClient.otp.reorder.mutate({ items })) as { records: WireRecord[] };
      const next = wire.map((r) => toCached(userId, r));
      if (persist) await replaceRecords(userId, next);
      if (vaultUserIdRef.current !== userId || keyRef.current !== key) return;
      await refresh(next);
    },
    [vaultUserId, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const current = cached.find((r) => r.id === id);
      if (!current) return;
      const row = (await otpTrpcClient.otp.remove.mutate({
        id,
        expectedRevision: current.revision,
      })) as WireRecord;
      await applyRow(row);
    },
    [cached, applyRow],
  );

  const clockSuspect = useMemo(() => {
    const shortestPeriod = records.reduce(
      (shortest, record) => Math.min(shortest, record.secrets?.period ?? Number.POSITIVE_INFINITY),
      Number.POSITIVE_INFINITY,
    );
    const halfPeriod = (Number.isFinite(shortestPeriod) ? shortestPeriod : 30) * 500;
    return Math.abs(serverTimeOffsetMs) > halfPeriod;
  }, [records, serverTimeOffsetMs]);

  const stateResolved = resolvedSessionKey === sessionKey;
  const visiblePhase: OtpPhase = stateResolved ? phase : 'loading';
  const visibleRecords = useMemo(() => (stateResolved ? records : []), [stateResolved, records]);

  const value = useMemo<OtpVaultValue>(
    () => ({
      phase: visiblePhase,
      syncState,
      trusted,
      vaultUserId,
      records: visibleRecords,
      serverTimeOffsetMs,
      clockSuspect,
      strandedUserIds,
      hydrated,
      enroll,
      forget,
      forgetUser,
      sync,
      create,
      updateSecrets,
      setStyle,
      setArchived,
      setPosition,
      renumber,
      remove,
    }),
    [
      visiblePhase,
      syncState,
      trusted,
      vaultUserId,
      visibleRecords,
      serverTimeOffsetMs,
      clockSuspect,
      strandedUserIds,
      hydrated,
      enroll,
      forget,
      forgetUser,
      sync,
      create,
      updateSecrets,
      setStyle,
      setArchived,
      setPosition,
      renumber,
      remove,
    ],
  );

  return <OtpVaultContext.Provider value={value}>{children}</OtpVaultContext.Provider>;
}
