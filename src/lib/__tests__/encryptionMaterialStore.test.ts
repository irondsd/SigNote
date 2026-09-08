/**
 * @jest-environment jsdom
 */
import '@/test/idb';

import {
  clearAllStoredMaterial,
  clearStoredMaterial,
  loadStoredMaterial,
  resolveMaterial,
  saveStoredMaterial,
  type StoredMaterial,
} from '@/lib/encryptionMaterialStore';

const ALICE = 'user-alice';
const BOB = 'user-bob';

const material = (serverShare: string): StoredMaterial => ({
  version: 1,
  serverShare,
  salt: 'c2FsdA==',
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 256 },
  keyCheck: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y3Q=' },
});

const offline = () => Promise.reject(new Error('Failed to fetch'));

beforeEach(async () => {
  await clearAllStoredMaterial();
});

describe('encryption material store', () => {
  it('keeps one account out of another', async () => {
    await saveStoredMaterial(ALICE, material('alice-share'));

    expect((await loadStoredMaterial(ALICE))?.serverShare).toBe('alice-share');
    expect(await loadStoredMaterial(BOB)).toBeNull();
  });

  it('clears one account without touching the other', async () => {
    await saveStoredMaterial(ALICE, material('alice-share'));
    await saveStoredMaterial(BOB, material('bob-share'));

    await clearStoredMaterial(ALICE);

    expect(await loadStoredMaterial(ALICE)).toBeNull();
    expect(await loadStoredMaterial(BOB)).not.toBeNull();
  });

  it('clears every account, which is what sign-out needs', async () => {
    await saveStoredMaterial(ALICE, material('alice-share'));
    await saveStoredMaterial(BOB, material('bob-share'));

    await clearAllStoredMaterial();

    expect(await loadStoredMaterial(ALICE)).toBeNull();
    expect(await loadStoredMaterial(BOB)).toBeNull();
  });
});

describe('resolveMaterial', () => {
  it('stores nothing when the account has not opted in', async () => {
    const fetched = await resolveMaterial(async () => material('fresh'), { userId: ALICE, allowed: false });

    expect(fetched.serverShare).toBe('fresh');
    expect(await loadStoredMaterial(ALICE)).toBeNull();
  });

  it('stores the share when the account has opted in', async () => {
    await resolveMaterial(async () => material('fresh'), { userId: ALICE, allowed: true });

    expect((await loadStoredMaterial(ALICE))?.serverShare).toBe('fresh');
  });

  it('deletes a share left over from before the account opted out', async () => {
    await saveStoredMaterial(ALICE, material('stale'));

    await resolveMaterial(async () => material('fresh'), { userId: ALICE, allowed: false });

    expect(await loadStoredMaterial(ALICE)).toBeNull();
  });

  it('neither stores nor deletes while the preference is still loading', async () => {
    await saveStoredMaterial(ALICE, material('kept'));

    await resolveMaterial(async () => material('fresh'), { userId: ALICE, allowed: undefined });

    // `undefined` is not `false`: a not-yet-loaded preference must not be read
    // as an opt-out and throw away a share the user asked us to keep.
    expect((await loadStoredMaterial(ALICE))?.serverShare).toBe('kept');
  });

  it('replaces the stored share, so a rotated one cannot go stale', async () => {
    await saveStoredMaterial(ALICE, material('old'));

    await resolveMaterial(async () => material('rotated'), { userId: ALICE, allowed: true });

    expect((await loadStoredMaterial(ALICE))?.serverShare).toBe('rotated');
  });

  it('falls back to the stored share when the request fails', async () => {
    await saveStoredMaterial(ALICE, material('offline-copy'));

    expect((await resolveMaterial(offline, { userId: ALICE, allowed: true })).serverShare).toBe('offline-copy');
  });

  it('propagates the failure when nothing was stored', async () => {
    await expect(resolveMaterial(offline, { userId: ALICE, allowed: false })).rejects.toThrow('Failed to fetch');
  });

  it("never reads another account's stored share", async () => {
    await saveStoredMaterial(BOB, material('bob-share'));

    await expect(resolveMaterial(offline, { userId: ALICE, allowed: true })).rejects.toThrow('Failed to fetch');
  });
});
