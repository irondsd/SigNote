'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { trpcClient } from '@/lib/trpcClient';
import { clearDeviceShare, loadDeviceShare, saveDeviceShare } from '@/lib/crypto';
import { clearStoredMaterial, type MaterialCachePolicy } from '@/lib/encryptionMaterialStore';
import { fetchEncryptionMaterial } from '@/lib/encryptionMaterial';
import { acquireVaultKeyWithPassphrase, createVaultProfile, reconstructMek } from '@/lib/vaultKey';
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

export type EncryptionPhase = 'loading' | 'setup' | 'locked' | 'unlocked';
export type LockType = 'none' | 'soft';

type EncryptionContextValue = {
  phase: EncryptionPhase;
  lockType: LockType;
  /** Monotonically increments each time lock() is called. Components snapshot this at mount
   *  and close themselves if it advances — the correct way to detect a hard-lock event. */
  lockSerial: number;
  mek: CryptoKey | null;
  unlock: (passphrase: string) => Promise<CryptoKey>;
  /** Checks the encryption passphrase without changing the vault lock state. */
  verifyPassphrase: (passphrase: string) => Promise<void>;
  lock: () => void;
  softLock: () => void;
  rehydrate: () => Promise<CryptoKey>;
  setupProfile: (passphrase: string) => Promise<void>;
};

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
    async (passphrase: string): Promise<CryptoKey> => {
      const { mek: key, deviceShare } = await acquireVaultKeyWithPassphrase(passphrase, policyRef.current);
      saveDeviceShare(deviceShare);
      setMek(key);
      setLockType('none');
      sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
      return key;
    },
    [setMek],
  );

  const verifyPassphrase = useCallback(async (passphrase: string): Promise<void> => {
    await acquireVaultKeyWithPassphrase(passphrase, policyRef.current);
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

  const rehydrate = useCallback(async (): Promise<CryptoKey> => {
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
    return key;
  }, [setMek]);

  const setupProfile = useCallback(
    async (passphrase: string): Promise<void> => {
      try {
        const { mek: newMek, deviceShare } = await createVaultProfile(passphrase);
        saveDeviceShare(deviceShare);
        setMek(newMek);
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : 'Failed to create encryption profile');
      }

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
