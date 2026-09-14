import {
  createKeyCheck,
  clearDeviceShare,
  deriveDeviceShare,
  generateSalt,
  generateServerShare,
  getDefaultKdfParams,
  getEncVersion,
  importMEK,
  loadDeviceShare,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import { HARD_LOCK_MS, SOFT_LOCK_TS_KEY } from '@/config/constants';
import { fetchEncryptionMaterial } from '@/lib/encryptionMaterial';
import type { MaterialCachePolicy, StoredMaterial } from '@/lib/encryptionMaterialStore';
import { trpcClient } from '@/lib/trpcClient';

export type AcquiredVaultKey = { mek: CryptoKey; deviceShare: Uint8Array };

export class IncorrectPassphraseError extends Error {
  constructor() {
    super('Incorrect passphrase');
    this.name = 'IncorrectPassphraseError';
  }
}

export async function reconstructMek(deviceShare: Uint8Array, material: StoredMaterial): Promise<CryptoKey | null> {
  const serverShareBytes = Uint8Array.from(atob(material.serverShare), (c) => c.charCodeAt(0));
  const mekBytes = xor32(deviceShare, serverShareBytes);
  const candidate = await importMEK(mekBytes);
  return (await verifyKeyCheck(candidate, material.keyCheck)) ? candidate : null;
}

export async function acquireVaultKeyWithPassphrase(
  passphrase: string,
  policy: MaterialCachePolicy,
): Promise<AcquiredVaultKey> {
  const material = await fetchEncryptionMaterial(policy);
  return acquireVaultKeyFromMaterial(passphrase, material);
}

export async function acquireVaultKeyFromMaterial(
  passphrase: string,
  material: StoredMaterial,
): Promise<AcquiredVaultKey> {
  const deviceShare = await deriveDeviceShare(passphrase, material.salt, material.kdf);
  const mek = await reconstructMek(deviceShare, material);
  if (!mek) throw new IncorrectPassphraseError();
  return { mek, deviceShare };
}

/**
 * Reconstructs a key from a still-valid vault session without mounting the
 * vault provider. It never persists new material and returns null for an
 * ordinary hard lock, which lets a one-shot action ask for the passphrase.
 */
export async function acquireResumableVaultKey(policy: MaterialCachePolicy): Promise<CryptoKey | null> {
  const softLockTs = sessionStorage.getItem(SOFT_LOCK_TS_KEY);
  if (softLockTs && Date.now() - Number(softLockTs) > HARD_LOCK_MS) {
    clearDeviceShare();
    sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
    return null;
  }

  const deviceShare = loadDeviceShare();
  if (!deviceShare) return null;

  try {
    const material = await fetchEncryptionMaterial(policy);
    const mek = await reconstructMek(deviceShare, material);
    if (!mek) clearDeviceShare();
    return mek;
  } catch {
    return null;
  }
}

/** Creates the server profile and returns the new key without deciding how it is retained. */
export async function createVaultProfile(passphrase: string): Promise<AcquiredVaultKey> {
  const salt = generateSalt();
  const serverShare = generateServerShare();
  const kdf = getDefaultKdfParams();
  const deviceShare = await deriveDeviceShare(passphrase, salt, kdf);
  const serverShareBytes = Uint8Array.from(atob(serverShare), (c) => c.charCodeAt(0));
  const mek = await importMEK(xor32(deviceShare, serverShareBytes));
  const keyCheck = await createKeyCheck(mek);

  await trpcClient.encryption.create.mutate({
    version: getEncVersion(),
    serverShare,
    salt,
    kdf,
    keyCheck,
  });

  return { mek, deviceShare };
}
