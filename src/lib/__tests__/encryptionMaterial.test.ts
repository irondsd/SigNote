import { createEncryptionMaterialPreloader } from '@/lib/encryptionMaterial';
import type { MaterialCachePolicy, StoredMaterial } from '@/lib/encryptionMaterialStore';

const ALICE: MaterialCachePolicy = { userId: 'user-alice', allowed: false };
const BOB: MaterialCachePolicy = { userId: 'user-bob', allowed: false };

const material = (serverShare: string): StoredMaterial => ({
  version: 1,
  serverShare,
  salt: 'c2FsdA==',
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
  keyCheck: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y3Q=' },
});

describe('createEncryptionMaterialPreloader', () => {
  it('reuses the request started before unlock is submitted', async () => {
    const fetcher = jest.fn(async () => material('alice-share'));
    const preloader = createEncryptionMaterialPreloader(fetcher);

    preloader.preload(ALICE);
    await expect(preloader.load(ALICE)).resolves.toEqual(material('alice-share'));

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never reuses material for another account', async () => {
    const fetcher = jest.fn(async (policy: MaterialCachePolicy) => material(`${policy.userId}-share`));
    const preloader = createEncryptionMaterialPreloader(fetcher);

    await preloader.load(ALICE);
    await expect(preloader.load(BOB)).resolves.toEqual(material('user-bob-share'));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('discards material when cleared or expired', async () => {
    let now = 1_000;
    const fetcher = jest.fn(async () => material(`share-${now}`));
    const preloader = createEncryptionMaterialPreloader(fetcher, 60_000, () => now);

    await preloader.load(ALICE);
    preloader.clear();
    await preloader.load(ALICE);
    now += 60_000;
    await preloader.load(ALICE);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('retries after a speculative request fails', async () => {
    const failure = new Error('offline');
    const fetcher = jest.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(material('retry-share'));
    const preloader = createEncryptionMaterialPreloader(fetcher);

    preloader.preload(ALICE);
    await expect(preloader.load(ALICE)).rejects.toBe(failure);
    await expect(preloader.load(ALICE)).resolves.toEqual(material('retry-share'));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
