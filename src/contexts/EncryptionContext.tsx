'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { HTTPError } from 'ky';
import { api } from '@/lib/api';
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
import { type EncryptedPayload, type KdfParams } from '@/types/crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProfileData = {
  version: number;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};

type ProfileResponse = { exists: false } | ({ exists: true } & ProfileData);

type MaterialResponse = {
  version: number;
  serverShare: string;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};

export type EncryptionPhase = 'loading' | 'setup' | 'locked' | 'unlocked';
export type LockType = 'none' | 'soft' | 'hard';

type EncryptionContextValue = {
  phase: EncryptionPhase;
  lockType: LockType;
  mek: CryptoKey | null;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  softLock: () => void;
  rehydrate: () => Promise<void>;
  setupProfile: (passphrase: string) => Promise<void>;
};

// ─── Private helpers ─────────────────────────────────────────────────────────

async function fetchMaterialRequest(): Promise<MaterialResponse> {
  return api.get('/api/encryption/material').json<MaterialResponse>();
}

async function reconstructMek(deviceShare: Uint8Array, material: MaterialResponse): Promise<CryptoKey | null> {
  const serverShareBytes = Uint8Array.from(atob(material.serverShare), (c) => c.charCodeAt(0));
  const mekBytes = xor32(deviceShare, serverShareBytes);
  const candidate = await importMEK(mekBytes);
  return (await verifyKeyCheck(candidate, material.keyCheck)) ? candidate : null;
}

// ─── Internal hook ────────────────────────────────────────────────────────────

function useMekRehydration(
  sessionStatus: string,
  profileExists: boolean,
): { mek: CryptoKey | null; setMek: (key: CryptoKey | null) => void } {
  const [mek, setMek] = useState<CryptoKey | null>(null);

  // Silent rehydration: if deviceShare is in sessionStorage, reconstruct MEK on mount
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !profileExists || mek) return;

    const deviceShare = loadDeviceShare();
    if (!deviceShare) return;

    (async () => {
      try {
        const material = await fetchMaterialRequest();
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
    queryFn: () => api.get('/api/encryption/profile').json<ProfileResponse>(),
    enabled: sessionStatus === 'authenticated' && !!userId,
    staleTime: Infinity, // profile rarely changes
  });

  const profileExists = !profileLoading && !!profileResponse?.exists;
  const { mek, setMek } = useMekRehydration(sessionStatus, profileExists);
  const [lockType, setLockType] = useState<LockType>('none');

  // Single source of truth for all rendering decisions
  const phase: EncryptionPhase = (() => {
    if (sessionStatus !== 'authenticated' || profileLoading) return 'loading';
    if (!profileResponse?.exists) return 'setup';
    return mek ? 'unlocked' : 'locked';
  })();

  const unlock = useCallback(
    async (passphrase: string): Promise<void> => {
      const material = await fetchMaterialRequest();
      const deviceShare = await deriveDeviceShare(passphrase, material.salt, material.kdf);
      const key = await reconstructMek(deviceShare, material);
      if (!key) throw new Error('Incorrect passphrase');
      saveDeviceShare(deviceShare);
      setMek(key);
      setLockType('none');
    },
    [setMek],
  );

  const lock = useCallback(() => {
    setMek(null);
    clearDeviceShare();
    setLockType('hard');
  }, [setMek]);

  const softLock = useCallback(() => {
    setMek(null);
    setLockType('soft');
  }, [setMek]);

  const rehydrate = useCallback(async (): Promise<void> => {
    const deviceShare = loadDeviceShare();
    if (!deviceShare) throw new Error('No device share available');
    const material = await fetchMaterialRequest();
    const key = await reconstructMek(deviceShare, material);
    if (!key) {
      clearDeviceShare();
      throw new Error('Failed to rehydrate');
    }
    setMek(key);
    setLockType('none');
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
        await api.post('/api/encryption/profile', {
          json: { version: getEncVersion(), serverShare: serverShareB64, salt, kdf: kdfParams, keyCheck },
        });
      } catch (e) {
        if (e instanceof HTTPError) {
          const body = await e.response.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || 'Failed to create encryption profile');
        }
        throw e;
      }

      saveDeviceShare(deviceShare);
      setMek(newMek);

      // Invalidate profile query so the page re-renders in unlocked state
      await qc.invalidateQueries({ queryKey: ['encryption-profile'] });
    },
    [qc, setMek],
  );

  return (
    <EncryptionContext.Provider value={{ phase, lockType, mek, unlock, lock, softLock, rehydrate, setupProfile }}>
      {children}
    </EncryptionContext.Provider>
  );
}
