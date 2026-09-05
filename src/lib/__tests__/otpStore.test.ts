/**
 * @jest-environment jsdom
 */
import '@/test/idb';

import {
  clearLastActiveUserId,
  getLastActiveUserId,
  listVaultUserIds,
  loadRecords,
  loadVault,
  putRecord,
  removeVault,
  replaceRecords,
  saveVault,
  setLastActiveUserId,
  updateVault,
  type OtpCachedRecord,
  type OtpVaultEntry,
} from '@/lib/otpStore';

const ALICE = 'user-alice';
const BOB = 'user-bob';

/** A real non-extractable AES-GCM key, so the structured-clone path is
 *  exercised rather than a stand-in object. */
async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function vault(userId: string, over: Partial<OtpVaultEntry> = {}): Promise<OtpVaultEntry> {
  return {
    userId,
    key: await makeKey(),
    profileId: 'profile-1',
    deviceId: 'device-1',
    enrolledAt: 1700000000000,
    serverTimeOffsetMs: 0,
    ...over,
  };
}

const record = (id: string, over: Partial<OtpCachedRecord> = {}): OtpCachedRecord => ({
  userId: ALICE,
  id,
  payload: { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'Y2lwaGVy' },
  payloadVersion: 1,
  position: 1000,
  revision: 1,
  archived: false,
  color: null,
  pattern: null,
  updatedAt: '2026-09-05T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

beforeEach(async () => {
  for (const id of await listVaultUserIds()) await removeVault(id);
  clearLastActiveUserId();
});

describe('vault entries', () => {
  it('round-trips a non-extractable CryptoKey', async () => {
    const entry = await vault(ALICE);
    await saveVault(entry);

    const loaded = await loadVault(ALICE);
    expect(loaded).not.toBeNull();
    expect(loaded!.profileId).toBe('profile-1');
    expect(loaded!.deviceId).toBe('device-1');

    // The point of storing a CryptoKey rather than raw bytes: what comes back
    // still cannot be exported by ordinary script on the origin.
    expect(loaded!.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', loaded!.key)).rejects.toThrow();
  });

  it('returns null for an account with no vault', async () => {
    await expect(loadVault('nobody')).resolves.toBeNull();
  });

  it('keeps accounts separate', async () => {
    await saveVault(await vault(ALICE, { profileId: 'p-alice' }));
    await saveVault(await vault(BOB, { profileId: 'p-bob' }));

    expect((await loadVault(ALICE))!.profileId).toBe('p-alice');
    expect((await loadVault(BOB))!.profileId).toBe('p-bob');
    expect((await listVaultUserIds()).sort()).toEqual([ALICE, BOB].sort());
  });

  it('patches a field without disturbing the key', async () => {
    await saveVault(await vault(ALICE));
    await updateVault(ALICE, { serverTimeOffsetMs: 2500 });

    const loaded = await loadVault(ALICE);
    expect(loaded!.serverTimeOffsetMs).toBe(2500);
    expect(loaded!.key.extractable).toBe(false);
  });

  it('ignores a patch for an account that is not enrolled', async () => {
    await updateVault('nobody', { serverTimeOffsetMs: 99 });
    await expect(loadVault('nobody')).resolves.toBeNull();
  });
});

describe('record cache', () => {
  it('stores and reads back per account', async () => {
    await replaceRecords(ALICE, [record('a'), record('b')]);
    await replaceRecords(BOB, [record('c', { userId: BOB })]);

    expect((await loadRecords(ALICE)).map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect((await loadRecords(BOB)).map((r) => r.id)).toEqual(['c']);
  });

  it('replaces rather than merges — a purged record disappears locally', async () => {
    await replaceRecords(ALICE, [record('a'), record('b')]);
    await replaceRecords(ALICE, [record('b')]);

    expect((await loadRecords(ALICE)).map((r) => r.id)).toEqual(['b']);
  });

  it('does not touch another account when replacing', async () => {
    await replaceRecords(ALICE, [record('a')]);
    await replaceRecords(BOB, [record('c', { userId: BOB })]);
    await replaceRecords(ALICE, []);

    expect(await loadRecords(ALICE)).toHaveLength(0);
    expect(await loadRecords(BOB)).toHaveLength(1);
  });

  it('keeps tombstones — the snapshot still has to reconcile them', async () => {
    await replaceRecords(ALICE, [record('gone', { payload: null, deletedAt: '2026-09-05T00:00:00.000Z' })]);
    const [stored] = await loadRecords(ALICE);
    expect(stored.payload).toBeNull();
    expect(stored.deletedAt).not.toBeNull();
  });

  it('upserts a single record in place', async () => {
    await replaceRecords(ALICE, [record('a', { revision: 1 })]);
    await putRecord(record('a', { revision: 2, archived: true }));

    const rows = await loadRecords(ALICE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ revision: 2, archived: true });
  });

  it('carries the presentation columns through', async () => {
    await replaceRecords(ALICE, [record('a', { color: 'teal', pattern: 'dots', archived: true })]);
    expect((await loadRecords(ALICE))[0]).toMatchObject({ color: 'teal', pattern: 'dots', archived: true });
  });
});

describe('removal', () => {
  it('drops the key and every cached record for that account only', async () => {
    await saveVault(await vault(ALICE));
    await saveVault(await vault(BOB));
    await replaceRecords(ALICE, [record('a')]);
    await replaceRecords(BOB, [record('c', { userId: BOB })]);

    await removeVault(ALICE);

    expect(await loadVault(ALICE)).toBeNull();
    expect(await loadRecords(ALICE)).toHaveLength(0);
    expect(await loadVault(BOB)).not.toBeNull();
    expect(await loadRecords(BOB)).toHaveLength(1);
  });

  it('is safe to call for an account that was never enrolled', async () => {
    await expect(removeVault('nobody')).resolves.toBeUndefined();
  });

  it('clears the last-active pointer when it named the removed account', async () => {
    await saveVault(await vault(ALICE));
    setLastActiveUserId(ALICE);
    await removeVault(ALICE);
    expect(getLastActiveUserId()).toBeNull();
  });

  it('leaves the last-active pointer alone when another account is removed', async () => {
    await saveVault(await vault(ALICE));
    await saveVault(await vault(BOB));
    setLastActiveUserId(ALICE);
    await removeVault(BOB);
    expect(getLastActiveUserId()).toBe(ALICE);
  });
});

describe('last active account', () => {
  it('remembers which vault to open with no session', () => {
    expect(getLastActiveUserId()).toBeNull();
    setLastActiveUserId(ALICE);
    expect(getLastActiveUserId()).toBe(ALICE);
    clearLastActiveUserId();
    expect(getLastActiveUserId()).toBeNull();
  });
});
