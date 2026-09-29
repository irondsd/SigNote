/** @jest-environment jsdom */

import '@/test/idb';

jest.mock('@/lib/trpcClient', () => ({
  trpcClient: { encryption: { update: { mutate: jest.fn() } } },
}));

import { trpcClient } from '@/lib/trpcClient';
import {
  createKeyCheck,
  deriveDeviceShare,
  deriveVaultKeyId,
  fromBase64,
  importMEK,
  loadDeviceShare,
  saveDeviceShare,
  toBase64,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import {
  clearAllStoredMaterial,
  loadStoredMaterial,
  resolveMaterial,
  saveStoredMaterial,
  type StoredMaterial,
} from '@/lib/encryptionMaterialStore';
import { updateEncryptionPassphrase } from '@/lib/updateEncryptionPassphrase';
import { acquireVaultKeyFromMaterial } from '@/lib/vaultKey';
import type { KdfParams } from '@/types/crypto';

const updateProfile = trpcClient.encryption.update.mutate as unknown as jest.Mock;
const USER_ID = 'user-alice';
const KDF: KdfParams = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1_000, length: 32 };
const MEK_BYTES = new Uint8Array(32).fill(42);
const NEW_PASSPHRASE = 'a replacement passphrase';

async function seedOldMaterial() {
  const oldSalt = toBase64(new Uint8Array(32).fill(3));
  const oldDeviceShare = await deriveDeviceShare('the previous passphrase', oldSalt, KDF);
  const mek = await importMEK(MEK_BYTES);
  const oldMaterial: StoredMaterial = {
    version: 7,
    serverShare: toBase64(xor32(MEK_BYTES, oldDeviceShare)),
    salt: oldSalt,
    kdf: KDF,
    keyCheck: await createKeyCheck(mek),
    vaultKeyId: await deriveVaultKeyId(mek),
  };

  saveDeviceShare(oldDeviceShare);
  await saveStoredMaterial(USER_ID, oldMaterial);
  return { oldDeviceShare, oldMaterial, mek };
}

beforeEach(async () => {
  sessionStorage.clear();
  updateProfile.mockReset();
  await clearAllStoredMaterial();
});

it('updates the opted-in cache so the new passphrase can rehydrate offline', async () => {
  const { oldDeviceShare, oldMaterial, mek } = await seedOldMaterial();
  updateProfile.mockImplementation(async () => {
    expect(loadDeviceShare()).toEqual(oldDeviceShare);
    expect(await loadStoredMaterial(USER_ID)).toEqual(oldMaterial);
    return { success: true };
  });

  await updateEncryptionPassphrase(MEK_BYTES, NEW_PASSPHRASE, oldMaterial, { userId: USER_ID, allowed: true });

  const payload = updateProfile.mock.calls[0][0];
  const newDeviceShare = await deriveDeviceShare(NEW_PASSPHRASE, payload.salt, KDF);
  const cached = await loadStoredMaterial(USER_ID);
  expect(cached).toEqual({
    ...oldMaterial,
    serverShare: payload.serverShare,
    salt: payload.salt,
    keyCheck: payload.keyCheck,
    vaultKeyId: payload.vaultKeyId,
  });
  expect(cached?.version).toBe(oldMaterial.version);
  expect(cached?.kdf).toEqual(oldMaterial.kdf);
  expect(loadDeviceShare()).toEqual(newDeviceShare);
  expect(xor32(newDeviceShare, fromBase64(payload.serverShare))).toEqual(MEK_BYTES);
  expect(await verifyKeyCheck(mek, payload.keyCheck)).toBe(true);
  expect(payload.vaultKeyId).toBe(await deriveVaultKeyId(mek));

  const offlineMaterial = await resolveMaterial(
    async () => {
      throw new Error('offline');
    },
    { userId: USER_ID, allowed: true },
  );
  const acquired = await acquireVaultKeyFromMaterial(NEW_PASSPHRASE, offlineMaterial);
  expect(await verifyKeyCheck(acquired.mek, offlineMaterial.keyCheck)).toBe(true);
  expect(acquired.deviceShare).toEqual(newDeviceShare);
});

it.each([false, undefined])('clears stale offline material when cache preference is %s', async (allowed) => {
  const { oldMaterial } = await seedOldMaterial();
  updateProfile.mockResolvedValue({ success: true });

  await updateEncryptionPassphrase(MEK_BYTES, NEW_PASSPHRASE, oldMaterial, { userId: USER_ID, allowed });

  expect(await loadStoredMaterial(USER_ID)).toBeNull();
  expect(loadDeviceShare()).not.toBeNull();
});

it('keeps the successful server update when saving the fresh cache fails', async () => {
  const { oldDeviceShare, oldMaterial } = await seedOldMaterial();
  updateProfile.mockResolvedValue({ success: true });
  const putSpy = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new Error('quota exceeded');
  });

  try {
    await expect(
      updateEncryptionPassphrase(MEK_BYTES, NEW_PASSPHRASE, oldMaterial, { userId: USER_ID, allowed: true }),
    ).resolves.toBeUndefined();
  } finally {
    putSpy.mockRestore();
  }

  expect(updateProfile).toHaveBeenCalledTimes(1);
  expect(await loadStoredMaterial(USER_ID)).toBeNull();
  expect(loadDeviceShare()).not.toEqual(oldDeviceShare);
});

it('leaves both old shares untouched when the server update fails', async () => {
  const { oldDeviceShare, oldMaterial } = await seedOldMaterial();
  updateProfile.mockRejectedValue(new Error('update failed'));

  await expect(
    updateEncryptionPassphrase(MEK_BYTES, NEW_PASSPHRASE, oldMaterial, { userId: USER_ID, allowed: true }),
  ).rejects.toThrow('update failed');

  expect(loadDeviceShare()).toEqual(oldDeviceShare);
  expect(await loadStoredMaterial(USER_ID)).toEqual(oldMaterial);
});
