'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { trpcClient } from '@/lib/trpcClient';
import {
  clearDeviceShare,
  createKeyCheck,
  deriveDeviceShare,
  generateSalt,
  generateServerShare,
  getDefaultKdfParams,
  getEncVersion,
  importMEK,
  loadDeviceShare,
  saveDeviceShare,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import { clearStoredMaterial, type MaterialCachePolicy, type StoredMaterial } from '@/lib/encryptionMaterialStore';
import { fetchEncryptionMaterial } from '@/lib/encryptionMaterial';
import { useSecurityPreferences } from '@/hooks/useSecurityPreferences';
import { HARD_LOCK_MS, SOFT_LOCK_TS_KEY } from '@/config/constants';
import { type EncryptedPayload, type KdfParams } from '@/types/crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProfileData = {
  version: number;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};

type ProfileResponse = { exists: false } | ({ exists: true } & ProfileData);

type MaterialResponse = StoredMaterial;

export type EncryptionPhase = 'loading' | 'setup' | 'locked' | 'unlocked';
export type LockType = 'none' | 'soft';

type EncryptionContextValue = {
  phase: EncryptionPhase;
  lockType: LockType;
  /** Monotonically increments each time lock() is called. Components snapshot this at mount
   *  and close themselves if it advances — the correct way to detect a hard-lock event. */
  lockSerial: number;
  mek: CryptoKey | null;
  unlock: (passphrase: string) => Promise<void>;
  /** Checks the encryption passphrase without changing the vault lock state. */
  verifyPassphrase: (passphrase: string) => Promise<void>;
  lock: () => void;
  softLock: () => void;
  rehydrate: () => Promise<void>;
  setupProfile: (passphrase: string) => Promise<void>;
};

// ─── Private helpers ─────────────────────────────────────────────────────────

async function reconstructMek(deviceShare: Uint8Array, material: MaterialResponse): Promise<CryptoKey | null> {
  const serverShareBytes = Uint8Array.from(atob(material.serverShare), (c) => c.charCodeAt(0));
  const mekBytes = xor32(deviceShare, serverShareBytes);
  const candidate = await importMEK(mekBytes);
  return (await verifyKeyCheck(candidate, material.keyCheck)) ? candidate : null;
}

async function verifiedMekFromPassphrase(
  passphrase: string,
  policy: MaterialCachePolicy,
): Promise<{ mek: CryptoKey; deviceShare: Uint8Array }> {
  const material = await fetchEncryptionMaterial(policy);
  const deviceShare = await deriveDeviceShare(passphrase, material.salt, material.kdf);
  const mek = await reconstructMek(deviceShare, material);
  if (!mek) throw new Error('Incorrect passphrase');
  return { mek, deviceShare };
}

// ─── Internal hook ────────────────────────────────────────────────────────────

function useMekRehydration(
  sessionStatus: string,
  profileExists: boolean,
  policyRef: MutableRefObject<MaterialCachePolicy>,
): { mek: CryptoKey | null; setMek: (key: CryptoKey | null) => void } {
  const [mek, setMek] = useState<CryptoKey | null>(null);

  // Silent rehydration resumes an ordinarily unlocked session after a reload.
  // An explicit soft lock is different: keep the share, but wait for a guarded
  // action before reconstructing the MEK so sensitive content is not exposed.
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !profileExists || mek) return;
    if (sessionStorage.getItem(SOFT_LOCK_TS_KEY)) return;

    const deviceShare = loadDeviceShare();
    if (!deviceShare) return;

    (async () => {
      try {
        const material = await fetchEncryptionMaterial(policyRef.current);
        const key = await reconstructMek(deviceShare, material);
        if (key) setMek(key);
        else clearDeviceShare();
      } catch {
        // Silently fail; user will need to unlock manually
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, profileExists]);

  // Lock when session ends
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      setMek(null);
      clearDeviceShare();
    }
  }, [sessionStatus]);

  return { mek, setMek };
}

// ─── Context ─────────────────────────────────────────────────────────────────

const EncryptionContext = createContext<EncryptionContextValue | null>(null);

export function useEncryption(): EncryptionContextValue {
  const ctx = useContext(EncryptionContext);
  if (!ctx) throw new Error('useEncryption must be used within EncryptionProvider');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function EncryptionProvider({ children }: { children: React.ReactNode }) {
  const { status: sessionStatus, data: sessionData } = useSession();
  const qc = useQueryClient();

  const userId = sessionData?.user?.id;

  // Fetch the encryption profile (non-sensitive metadata)
  const { data: profileResponse, isLoading: profileLoading } = useQuery<ProfileResponse>({
    queryKey: ['encryption-profile', userId],
    queryFn: async () => (await trpcClient.encryption.profile.query()) as unknown as ProfileResponse,
    enabled: sessionStatus === 'authenticated' && !!userId,
    staleTime: Infinity, // profile rarely changes
  });

  const profileExists = !profileLoading && !!profileResponse?.exists;

  // Whether this device may keep `serverShare`. Held in a ref because every
  // reader is an async call made after render — rebuilding the callbacks below
  // when the preference resolves would churn the identities that consumers
  // list in effect deps, for a value none of them read.
  //
  // The preference is account-wide, so an `allowed: false` arriving here also
  // deletes what a device that was never the one toggled had kept.
  const { data: security } = useSecurityPreferences();
  const policyRef = useRef<MaterialCachePolicy>({ userId, allowed: security?.cacheServerShare });
  useEffect(() => {
    policyRef.current = { userId, allowed: security?.cacheServerShare };
    if (userId && security?.cacheServerShare === false) void clearStoredMaterial(userId).catch(() => undefined);
  }, [userId, security?.cacheServerShare]);

  const { mek, setMek } = useMekRehydration(sessionStatus, profileExists, policyRef);
  // If deviceShare is already in sessionStorage on mount, treat as soft-locked so
  // handleNoteClick (and any other guard callers) try ctxRehydrate() before prompting.
  const [lockType, setLockType] = useState<LockType>(() =>
    typeof window !== 'undefined' && loadDeviceShare() !== null ? 'soft' : 'none',
  );
  const [lockSerial, setLockSerial] = useState(0);

  // Single source of truth for all rendering decisions
  const phase: EncryptionPhase = (() => {
    if (sessionStatus !== 'authenticated' || profileLoading) return 'loading';
    if (!profileResponse?.exists) return 'setup';
    return mek ? 'unlocked' : 'locked';
  })();

  const unlock = useCallback(
    async (passphrase: string): Promise<void> => {
      const { mek: key, deviceShare } = await verifiedMekFromPassphrase(passphrase, policyRef.current);
      saveDeviceShare(deviceShare);
      setMek(key);
      setLockType('none');
      sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
    },
    [setMek],
  );

  const verifyPassphrase = useCallback(async (passphrase: string): Promise<void> => {
    await verifiedMekFromPassphrase(passphrase, policyRef.current);
  }, []);

  const lock = useCallback(() => {
    posthog.capture('vault_locked', { type: 'hard' });
    setMek(null);
    clearDeviceShare();
    setLockType('none');
    setLockSerial((s) => s + 1);
    sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
  }, [setMek]);

  const softLock = useCallback(() => {
    posthog.capture('vault_locked', { type: 'soft' });
    setMek(null);
    setLockType('soft');
    sessionStorage.setItem(SOFT_LOCK_TS_KEY, Date.now().toString());
  }, [setMek]);

  const rehydrate = useCallback(async (): Promise<void> => {
    const softLockTs = sessionStorage.getItem(SOFT_LOCK_TS_KEY);
    if (softLockTs && Date.now() - parseInt(softLockTs, 10) > HARD_LOCK_MS) {
      clearDeviceShare();
      setMek(null);
      setLockType('none');
      setLockSerial((s) => s + 1);
      sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
      throw new Error('Session expired');
    }

    const deviceShare = loadDeviceShare();
    if (!deviceShare) throw new Error('No device share available');
    const material = await fetchEncryptionMaterial(policyRef.current);
    const key = await reconstructMek(deviceShare, material);
    if (!key) {
      clearDeviceShare();
      throw new Error('Failed to rehydrate');
    }
    setMek(key);
    setLockType('none');
    sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
  }, [setMek]);

  const setupProfile = useCallback(
    async (passphrase: string): Promise<void> => {
      const salt = generateSalt();
      const serverShareB64 = generateServerShare();
      const kdfParams = getDefaultKdfParams();

      const deviceShare = await deriveDeviceShare(passphrase, salt, kdfParams);
      const serverShareBytes = Uint8Array.from(atob(serverShareB64), (c) => c.charCodeAt(0));
      const mekBytes = xor32(deviceShare, serverShareBytes);
      const newMek = await importMEK(mekBytes);

      const keyCheck = await createKeyCheck(newMek);

      try {
        await trpcClient.encryption.create.mutate({
          version: getEncVersion(),
          serverShare: serverShareB64,
          salt,
          kdf: kdfParams,
          keyCheck,
        });
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : 'Failed to create encryption profile');
      }

      saveDeviceShare(deviceShare);
      setMek(newMek);

      // Invalidate profile query so the page re-renders in unlocked state
      await qc.invalidateQueries({ queryKey: ['encryption-profile'] });
    },
    [qc, setMek],
  );

  return (
    <EncryptionContext.Provider
      value={{ phase, lockType, lockSerial, mek, unlock, verifyPassphrase, lock, softLock, rehydrate, setupProfile }}
    >
      {children}
    </EncryptionContext.Provider>
  );
}
