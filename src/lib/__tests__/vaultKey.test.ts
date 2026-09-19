import { createKeyCheck, deriveVaultKeyId, importMEK, toBase64, xor32 } from '@/lib/crypto';
import type { StoredMaterial } from '@/lib/encryptionMaterialStore';
import { reconstructMek, VaultKeyIdMismatchError } from '@/lib/vaultKey';

async function fixture(vaultKeyId: string | null | undefined) {
  const mekBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const deviceShare = new Uint8Array(32).fill(0xa5);
  const mek = await importMEK(mekBytes);
  const material: StoredMaterial = {
    version: 1,
    serverShare: toBase64(xor32(mekBytes, deviceShare)),
    salt: toBase64(new Uint8Array(32)),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
    keyCheck: await createKeyCheck(mek),
    vaultKeyId,
  };
  return { mek, deviceShare, material, derived: await deriveVaultKeyId(mek) };
}

describe('vault identity verification during reconstruction', () => {
  it('accepts a matching identifier', async () => {
    const value = await fixture(null);
    value.material.vaultKeyId = value.derived;

    await expect(reconstructMek(value.deviceShare, value.material)).resolves.toBeInstanceOf(CryptoKey);
  });

  it('accepts a legacy profile with no identifier so it can be backfilled', async () => {
    const value = await fixture(undefined);

    await expect(reconstructMek(value.deviceShare, value.material)).resolves.toBeInstanceOf(CryptoKey);
  });

  it('fails closed when authenticated material names a different MEK', async () => {
    const value = await fixture('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    await expect(reconstructMek(value.deviceShare, value.material)).rejects.toBeInstanceOf(VaultKeyIdMismatchError);
  });
});
