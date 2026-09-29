'use client';

import {
  createKeyCheck,
  deriveDeviceShare,
  deriveVaultKeyId,
  generateSalt,
  importMEK,
  saveDeviceShare,
  toBase64,
  xor32,
} from '@/lib/crypto';
import {
  clearStoredMaterial,
  saveStoredMaterial,
  type MaterialCachePolicy,
  type StoredMaterial,
} from '@/lib/encryptionMaterialStore';
import { trpcClient } from '@/lib/trpcClient';

/** Keep the MEK unchanged while replacing the passphrase-derived device share. */
export async function updateEncryptionPassphrase(
  mekBytes: Uint8Array<ArrayBuffer>,
  passphrase: string,
  currentMaterial: StoredMaterial,
  cachePolicy: MaterialCachePolicy,
): Promise<void> {
  const { userId, allowed } = cachePolicy;
  if (!userId) throw new Error('Could not identify the signed-in account');

  const { kdf } = currentMaterial;
  const salt = generateSalt();
  const deviceShare = await deriveDeviceShare(passphrase, salt, kdf);
  const serverShare = toBase64(xor32(mekBytes, deviceShare));
  const mek = await importMEK(mekBytes);
  const keyCheck = await createKeyCheck(mek);
  const vaultKeyId = await deriveVaultKeyId(mek);
  const updatedMaterial: StoredMaterial = {
    ...currentMaterial,
    serverShare,
    salt,
    keyCheck,
    vaultKeyId,
  };

  await trpcClient.encryption.update.mutate({
    serverShare,
    salt,
    keyCheck,
    vaultKeyId,
  });

  // A successful profile update makes the previous offline material unusable
  // with this new device share. Keep the opted-in copy in sync; otherwise drop
  // it so an offline fallback cannot pair the new share with stale material.
  try {
    if (allowed === true) await saveStoredMaterial(userId, updatedMaterial);
    else await clearStoredMaterial(userId);
  } catch {
    // The server update is already committed. If saving the fresh copy fails,
    // remove the stale one where possible without reporting a false update
    // failure to the user.
    await clearStoredMaterial(userId).catch(() => undefined);
  }

  // Replace the session share only after the server accepted the update and the
  // cache sync was attempted. IndexedDB and sessionStorage cannot be committed
  // atomically, so concurrent rehydration during this brief window may fail.
  saveDeviceShare(deviceShare);
}
