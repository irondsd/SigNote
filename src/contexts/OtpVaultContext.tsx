'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { v7 as uuidv7 } from 'uuid';

import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { deriveOtpVaultKey } from '@/lib/crypto';
import { compareAuthRecords, nextAuthPosition, renumberPositions } from '@/lib/otp/order';
import { decryptOtpRecord, encryptOtpRecord, type OtpSecrets } from '@/lib/otp/record';
import {
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
import { conflictRow, isUnauthorized, otpTrpcClient } from '@/lib/otpTrpcClient';

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
  /** Session expired. Same as offline, but says so — it never signs the user out. */
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
  /** Which account's vault is on screen — may differ from the session user
   *  when the app is offline and signed out. */
  vaultUserId: string | null;
  records: AuthRecord[];
  /** Clock correction. Codes are generated from `Date.now() + this`. */
  serverTimeOffsetMs: number;
  /** True when the device clock is more than half a period out. */
  clockSuspect: boolean;
  /** Vaults belonging to *other* accounts, offered for removal on sign-in. */
  strandedUserIds: string[];

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

  const [phase, setPhase] = useState<OtpPhase>('loading');
  const [syncState, setSyncState] = useState<OtpSyncState>('idle');
  const [trusted, setTrusted] = useState(false);
  const [vaultUserId, setVaultUserId] = useState<string | null>(null);
  const [cached, setCached] = useState<OtpCachedRecord[]>([]);
  const [records, setRecords] = useState<AuthRecord[]>([]);
  const [serverTimeOffsetMs, setOffset] = useState(0);
  const [strandedUserIds, setStranded] = useState<string[]>([]);

  // The key never enters React state: it is not renderable, and keeping it in a
  // ref avoids it being captured by stale closures across a re-render.
  const keyRef = useRef<CryptoKey | null>(null);
  const profileIdRef = useRef<string | null>(null);
  const trustedRef = useRef(false);

  const setKey = useCallback((key: CryptoKey | null, isTrusted: boolean) => {
    keyRef.current = key;
    trustedRef.current = isTrusted;
    setTrusted(isTrusted);
  }, []);

  /** Re-derives the rendered list from the encrypted cache. */
  const refresh = useCallback(async (next: OtpCachedRecord[]) => {
    setCached(next);
    const key = keyRef.current;
    setRecords(key ? await decryptAll(key, next) : []);
  }, []);

  // ── Local resolution ───────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    let cancelled = false;

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
        setVaultUserId(null);
        setPhase(sessionUserId ? 'not-enrolled' : 'signed-out');
        return;
      }

      setVaultUserId(target);
      const vault = await loadVault(target);
      if (cancelled) return;

      if (!vault) {
        setKey(null, false);
        setPhase(sessionUserId ? 'not-enrolled' : 'signed-out');
        return;
      }

      setKey(vault.key, true);
      profileIdRef.current = vault.profileId;
      setOffset(vault.serverTimeOffsetMs);
      await refresh(await loadRecords(target));
      if (!cancelled) setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
    // A memory-only session must survive re-renders; only a real session change
    // re-resolves the vault.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, sessionUserId]);

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

  const announceRemoval = (userId: string) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: 'vault-removed', userId });
    channel.close();
  };

  // ── Sync ───────────────────────────────────────────────────────────────────

  const sync = useCallback(async () => {
    const userId = vaultUserId;
    if (!userId || !keyRef.current || sessionStatus !== 'authenticated') return;

    setSyncState('syncing');
    try {
      const [{ records: wire, serverTime }, profile] = await Promise.all([
        otpTrpcClient.otp.list.query() as Promise<{ records: WireRecord[]; serverTime: number }>,
        otpTrpcClient.encryption.profile.query() as Promise<{ exists: boolean; profileId?: string }>,
      ]);

      // The profile generation is the only remote kill switch in v1. A new id
      // means the encryption profile was reset, so this key can no longer
      // decrypt anything and the device returns to not-enrolled.
      if (profile.exists && profileIdRef.current && profile.profileId !== profileIdRef.current) {
        await removeVault(userId);
        announceRemoval(userId);
        setKey(null, false);
        setCached([]);
        setRecords([]);
        setPhase('not-enrolled');
        setSyncState('online');
        return;
      }

      const offset = serverTime - Date.now();
      setOffset(offset);

      const next = wire.map((r) => toCached(userId, r));
      if (trustedRef.current) {
        await replaceRecords(userId, next);
        await updateVault(userId, { serverTimeOffsetMs: offset });
      }
      await refresh(next);
      setSyncState('online');
    } catch (err) {
      // A 401 pauses sync and nothing else — it must never sign the user out.
      setSyncState(isUnauthorized(err) ? 'signed-out' : navigator.onLine ? 'error' : 'offline');
    }
  }, [vaultUserId, sessionStatus, refresh, setKey]);

  useEffect(() => {
    if (phase === 'ready' && sessionStatus === 'authenticated') void sync();
  }, [phase, sessionStatus, sync]);

  // ── Enrollment ─────────────────────────────────────────────────────────────

  const enroll = useCallback(
    async (mek: CryptoKey, { trust }: { trust: boolean }) => {
      if (!sessionUserId) throw new Error('Sign in to set up the authenticator');

      const key = await deriveOtpVaultKey(mek);
      const profile = (await otpTrpcClient.encryption.profile.query()) as { exists: boolean; profileId?: string };
      const profileId = profile.profileId ?? '';

      if (trust) {
        try {
          await saveVault({
            userId: sessionUserId,
            key,
            profileId,
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
      setKey(key, trust);
      setVaultUserId(sessionUserId);
      setPhase('ready');
    },
    [sessionUserId, setKey],
  );

  const forgetUser = useCallback(
    async (userId: string) => {
      await removeVault(userId);
      announceRemoval(userId);
      setStranded((prev) => prev.filter((id) => id !== userId));
      if (userId === vaultUserId) {
        setKey(null, false);
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
      // In place. Filtering the record out and pushing it back on the end
      // reorders the array, and with a stable sort that moved the card to the
      // end of any group sharing its position — which is what made recolouring
      // a card appear to send it to the bottom of the list.
      const updated = toCached(userId, row);
      const next = cached.some((r) => r.id === row.id)
        ? cached.map((r) => (r.id === row.id ? updated : r))
        : [...cached, updated];
      if (trustedRef.current) await replaceRecords(userId, next);
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
      const items = renumberPositions(ordered);
      const { records: wire } = (await otpTrpcClient.otp.reorder.mutate({ items })) as { records: WireRecord[] };
      const next = wire.map((r) => toCached(userId, r));
      if (trustedRef.current) await replaceRecords(userId, next);
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
    const halfPeriod = 15_000;
    return Math.abs(serverTimeOffsetMs) > halfPeriod;
  }, [serverTimeOffsetMs]);

  const value = useMemo<OtpVaultValue>(
    () => ({
      phase,
      syncState,
      trusted,
      vaultUserId,
      records,
      serverTimeOffsetMs,
      clockSuspect,
      strandedUserIds,
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
      phase,
      syncState,
      trusted,
      vaultUserId,
      records,
      serverTimeOffsetMs,
      clockSuspect,
      strandedUserIds,
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
