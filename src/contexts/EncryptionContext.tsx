'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
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

export type ProfileStatus = 'loading' | 'missing' | 'exists';

type EncryptionContextValue = {
  profileStatus: ProfileStatus;
  isUnlocked: boolean;
  mek: CryptoKey | null;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  setupProfile: (passphrase: string) => Promise<void>;
};

// ─── Context ─────────────────────────────────────────────────────────────────

const EncryptionContext = createContext<EncryptionContextValue | null>(null);

export function useEncryption(): EncryptionContextValue {
  const ctx = useContext(EncryptionContext);
  if (!ctx) throw new Error('useEncryption must be used within EncryptionProvider');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function EncryptionProvider({ children }: { children: React.ReactNode }) {
  const { status: sessionStatus } = useSession();
  const qc = useQueryClient();
  const [mek, setMek] = useState<CryptoKey | null>(null);

  // Fetch the encryption profile (non-sensitive metadata)
  const { data: profileResponse, isLoading: profileLoading } = useQuery<ProfileResponse>({
    queryKey: ['encryption-profile'],
    queryFn: async () => {
      const res = await fetch('/api/encryption/profile');
      if (!res.ok) throw new Error('Failed to fetch encryption profile');
      return res.json();
    },
    enabled: sessionStatus === 'authenticated',
    staleTime: Infinity, // profile rarely changes
  });

  // Compute profile status
  const profileStatus: ProfileStatus = (() => {
    if (sessionStatus !== 'authenticated' || profileLoading) return 'loading';
    if (!profileResponse) return 'loading';
    return profileResponse.exists ? 'exists' : 'missing';
  })();

  // Fetch encryption material (includes serverShare) — only when needed
  const fetchMaterial = useCallback(async (): Promise<MaterialResponse> => {
    const res = await fetch('/api/encryption/material');
    if (!res.ok) throw new Error('Failed to fetch encryption material');
    return res.json();
  }, []);

  // Silent re-hydration: if deviceShare is in sessionStorage, reconstruct MEK on mount
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || profileStatus !== 'exists' || mek) return;

    const deviceShare = loadDeviceShare();
    if (!deviceShare) return;

    (async () => {
      try {
        const material = await fetchMaterial();
        const serverShareBytes = Uint8Array.from(atob(material.serverShare), (c) => c.charCodeAt(0));
        const mekBytes = xor32(deviceShare, serverShareBytes);
        const reconstructed = await importMEK(mekBytes);

        // Verify key check before setting MEK
        const valid = await verifyKeyCheck(reconstructed, material.keyCheck);
        if (valid) {
          setMek(reconstructed);
        } else {
          // Stored deviceShare is stale/wrong — clear it
          clearDeviceShare();
        }
      } catch {
        // Silently fail; user will need to unlock manually
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, profileStatus]);

  // Lock when session ends
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      setMek(null);
      clearDeviceShare();
    }
  }, [sessionStatus]);

  const unlock = useCallback(
    async (passphrase: string): Promise<void> => {
      const material = await fetchMaterial();
      const deviceShare = await deriveDeviceShare(passphrase, material.salt, material.kdf);
      const serverShareBytes = Uint8Array.from(atob(material.serverShare), (c) => c.charCodeAt(0));
      const mekBytes = xor32(deviceShare, serverShareBytes);
      const candidate = await importMEK(mekBytes);

      const valid = await verifyKeyCheck(candidate, material.keyCheck);
      if (!valid) {
        throw new Error('Incorrect passphrase');
      }

      saveDeviceShare(deviceShare);
      setMek(candidate);
    },
    [fetchMaterial],
  );

  const lock = useCallback(() => {
    setMek(null);
    clearDeviceShare();
  }, []);

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

      const res = await fetch('/api/encryption/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: getEncVersion(),
          serverShare: serverShareB64,
          salt,
          kdf: kdfParams,
          keyCheck,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create encryption profile');
      }

      saveDeviceShare(deviceShare);
      setMek(newMek);

      // Invalidate profile query so the page re-renders in unlocked state
      await qc.invalidateQueries({ queryKey: ['encryption-profile'] });
    },
    [qc],
  );

  return (
    <EncryptionContext.Provider
      value={{
        profileStatus,
        isUnlocked: mek !== null,
        mek,
        unlock,
        lock,
        setupProfile,
      }}
    >
      {children}
    </EncryptionContext.Provider>
  );
}
