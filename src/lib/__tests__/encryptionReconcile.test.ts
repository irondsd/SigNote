/**
 * @jest-environment jsdom
 */
import '@/test/idb';

import { ENC_SESSION_KEY, SOFT_LOCK_TS_KEY } from '@/config/constants';
import { saveDraft, loadDrafts } from '@/lib/draft';
import { completeReconciliation, needsReconciliation, observeGeneration, readMarker } from '@/lib/encryptionGeneration';
import { reconcileToGeneration } from '@/lib/encryptionReconcile';
import { loadStoredMaterial, saveStoredMaterial, type StoredMaterial } from '@/lib/encryptionMaterialStore';
import { loadVault, saveVault } from '@/lib/otpStore';
import { queryCacheStorage } from '@/lib/idb';

const ALICE = 'user-alice';

const material: StoredMaterial = {
  version: 1,
  serverShare: 'c2VydmVyLXNoYXJl',
  salt: 'c2FsdA==',
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 256 },
  keyCheck: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y3Q=' },
};

const vaultKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;

/** A minimal Cache Storage: enough to prove which names are deleted. */
function installCaches(names: string[]): { remaining: () => string[] } {
  const present = new Set(names);
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      keys: async () => [...present],
      delete: async (name: string) => present.delete(name),
      open: async () => ({ keys: async () => [], delete: async () => true }),
    },
  });
  return { remaining: () => [...present] };
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await queryCacheStorage.removeItem('signote-query-cache');
  installCaches([]);
});

async function seedDevice() {
  sessionStorage.setItem(ENC_SESSION_KEY, 'ZGV2aWNlLXNoYXJl');
  sessionStorage.setItem(SOFT_LOCK_TS_KEY, '1700000000000');
  await saveStoredMaterial(ALICE, material);
  await saveVault({
    userId: ALICE,
    key: await vaultKey(),
    profileId: 'profile-1',
    deviceId: 'device-1',
    enrolledAt: 1,
    serverTimeOffsetMs: 0,
  });
  await queryCacheStorage.setItem('signote-query-cache', '{"clientState":{}}');
  saveDraft({ type: 'note', title: 'Plain', content: '<p>kept</p>', savedAt: 2, draftId: 'plain' });
  saveDraft({
    type: 'secret',
    title: 'Sealed',
    enc: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y3Q=' },
    savedAt: 1,
    draftId: 'sealed',
  });
}

it('removes every value derived from the superseded key', async () => {
  await seedDevice();
  observeGeneration(ALICE, 1);
  observeGeneration(ALICE, 2);

  const ok = await reconcileToGeneration({ userId: ALICE, generation: 2 });

  expect(ok).toBe(true);
  expect(sessionStorage.getItem(ENC_SESSION_KEY)).toBeNull();
  expect(sessionStorage.getItem(SOFT_LOCK_TS_KEY)).toBeNull();
  expect(await loadStoredMaterial(ALICE)).toBeNull();
  expect(await loadVault(ALICE)).toBeNull();
  expect(await queryCacheStorage.getItem('signote-query-cache')).toBeNull();
});

it('discards encrypted drafts and keeps plaintext ones', async () => {
  await seedDevice();
  observeGeneration(ALICE, 1);
  observeGeneration(ALICE, 2);

  await reconcileToGeneration({ userId: ALICE, generation: 2 });

  expect(loadDrafts().map((draft) => draft.draftId)).toEqual(['plain']);
});

it('marks the device caught up only once every step succeeded', async () => {
  await seedDevice();
  observeGeneration(ALICE, 1);
  observeGeneration(ALICE, 2);
  expect(needsReconciliation(ALICE)).toBe(true);

  await reconcileToGeneration({ userId: ALICE, generation: 2 });

  expect(readMarker(ALICE)).toEqual({ generation: 2, reconciled: true });
  expect(needsReconciliation(ALICE)).toBe(false);
});

it('leaves the marker dirty when a step fails, so the next launch retries', async () => {
  await seedDevice();
  observeGeneration(ALICE, 1);
  observeGeneration(ALICE, 2);
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      keys: async () => {
        throw new Error('cache storage unavailable');
      },
    },
  });

  const ok = await reconcileToGeneration({ userId: ALICE, generation: 2 });

  expect(ok).toBe(false);
  expect(needsReconciliation(ALICE)).toBe(true);
});

it('drops only the caches that can hold a superseded body', async () => {
  const caches = installCaches(['signote-apis-v1', 'pages-cache', 'static-image-assets', 'google-fonts']);
  await seedDevice();

  await reconcileToGeneration({ userId: ALICE, generation: 2 });

  expect(caches.remaining().sort()).toEqual(['google-fonts', 'static-image-assets']);
});

it('can keep the Authenticator for a device that re-enrolls itself', async () => {
  await seedDevice();

  await reconcileToGeneration({ userId: ALICE, generation: 2, keepAuthenticator: true });

  expect(await loadVault(ALICE)).not.toBeNull();
});

it('is a no-op without an account', async () => {
  await seedDevice();
  completeReconciliation(ALICE, 2);

  expect(await reconcileToGeneration({ userId: '', generation: 2 })).toBe(false);
  expect(sessionStorage.getItem(ENC_SESSION_KEY)).toBe('ZGV2aWNlLXNoYXJl');
});

it('keeps reconciliation pending when removing the device share fails', async () => {
  await seedDevice();
  observeGeneration(ALICE, 1);
  observeGeneration(ALICE, 2);
  const remove = Storage.prototype.removeItem;
  const fault = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
    if (this === sessionStorage) throw new Error('storage unavailable');
    remove.call(this, key);
  });
  try {
    expect(await reconcileToGeneration({ userId: ALICE, generation: 2 })).toBe(false);
    expect(needsReconciliation(ALICE)).toBe(true);
  } finally {
    fault.mockRestore();
  }
});
