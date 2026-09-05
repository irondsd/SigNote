import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { MAX_OTP_RECORDS_PER_USER, OTP_TOMBSTONE_RETENTION_MS } from '@/config/constants';
import {
  countLiveOtpRecords,
  createOtpRecord,
  deleteOtpRecord,
  listOtpRecords,
  OtpConflictError,
  OtpLimitError,
  purgeOtpTombstones,
  reorderOtpRecords,
  updateOtpRecord,
} from '@/controllers/otpRecords';
import type { Db } from '@/db/client';
import { otpRecords } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { EncryptedPayload } from '@/types/crypto';

let db: Db;

const ALICE = 'user-alice';
const BOB = 'user-bob';

const payload = (marker: string): EncryptedPayload => ({
  alg: 'A256GCM',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: Buffer.from(marker).toString('base64'),
});

const add = (userId: string, marker = 'one', position = 1000, id = uuidv7()) =>
  createOtpRecord(userId, { id, payload: payload(marker), payloadVersion: 1, position });

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

describe('createOtpRecord', () => {
  it('stores the envelope and starts at revision 1', async () => {
    const row = await add(ALICE, 'first');
    expect(row).toMatchObject({ revision: 1, payloadVersion: 1, position: 1000, deletedAt: null });
    expect(row.payload).toEqual(payload('first'));
  });

  it('accepts the client-generated id verbatim', async () => {
    const id = uuidv7();
    await expect(add(ALICE, 'one', 1000, id)).resolves.toMatchObject({ id });
  });

  it('rejects a duplicate id — a retried create must not overwrite', async () => {
    const id = uuidv7();
    await add(ALICE, 'original', 1000, id);
    await expect(add(ALICE, 'replacement', 2000, id)).rejects.toThrow(OtpConflictError);

    const [row] = await listOtpRecords(ALICE);
    expect(row.payload).toEqual(payload('original'));
  });

  it('rejects an id taken by another user without revealing the row', async () => {
    const id = uuidv7();
    await add(BOB, 'bob', 1000, id);

    await expect(add(ALICE, 'alice', 1000, id)).rejects.toMatchObject({
      name: 'OtpConflictError',
      // Alice's conflict carries no row: the id is scoped out of her view.
      current: null,
    });
    expect(await listOtpRecords(ALICE)).toHaveLength(0);
  });

  it('rejects an id belonging to a tombstone — a deleted credential stays deleted', async () => {
    const id = uuidv7();
    const row = await add(ALICE, 'gone', 1000, id);
    await deleteOtpRecord(ALICE, id, row.revision);

    await expect(add(ALICE, 'resurrected', 1000, id)).rejects.toThrow(OtpConflictError);
  });

  it('enforces the per-user cap on live records', async () => {
    // Seed the table directly; MAX_OTP_RECORDS_PER_USER creates would be slow.
    const now = new Date();
    await db.insert(otpRecords).values(
      Array.from({ length: MAX_OTP_RECORDS_PER_USER }, (_, i) => ({
        id: uuidv7(),
        userId: ALICE,
        payload: payload(`seed-${i}`),
        payloadVersion: 1,
        position: i,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    );

    await expect(add(ALICE, 'over')).rejects.toThrow(OtpLimitError);
    // The cap is per user, and another account is unaffected.
    await expect(add(BOB, 'fine')).resolves.toBeDefined();
  });

  it('counts only live records against the cap', async () => {
    const row = await add(ALICE);
    expect(await countLiveOtpRecords(ALICE)).toBe(1);
    await deleteOtpRecord(ALICE, row.id, row.revision);
    expect(await countLiveOtpRecords(ALICE)).toBe(0);
  });
});

describe('listOtpRecords — the sync snapshot', () => {
  it('returns only the caller’s rows', async () => {
    await add(ALICE, 'a');
    await add(BOB, 'b');

    const alice = await listOtpRecords(ALICE);
    expect(alice).toHaveLength(1);
    expect(alice[0].payload).toEqual(payload('a'));
  });

  it('orders by position', async () => {
    await add(ALICE, 'third', 3000);
    await add(ALICE, 'first', 1000);
    await add(ALICE, 'second', 2000);

    expect((await listOtpRecords(ALICE)).map((r) => r.position)).toEqual([1000, 2000, 3000]);
  });

  it('includes tombstones with a null payload', async () => {
    const kept = await add(ALICE, 'kept', 1000);
    const removed = await add(ALICE, 'removed', 2000);
    await deleteOtpRecord(ALICE, removed.id, removed.revision);

    const rows = await listOtpRecords(ALICE);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === kept.id)?.payload).not.toBeNull();

    const tombstone = rows.find((r) => r.id === removed.id)!;
    expect(tombstone.payload).toBeNull();
    expect(tombstone.deletedAt).toBeInstanceOf(Date);
  });
});

describe('updateOtpRecord', () => {
  it('advances the revision and replaces the payload', async () => {
    const row = await add(ALICE, 'before');
    const updated = await updateOtpRecord(ALICE, {
      id: row.id,
      expectedRevision: row.revision,
      payload: payload('after'),
    });

    expect(updated.revision).toBe(2);
    expect(updated.payload).toEqual(payload('after'));
  });

  it('updates position alone without touching the payload', async () => {
    const row = await add(ALICE, 'body');
    const moved = await updateOtpRecord(ALICE, { id: row.id, expectedRevision: 1, position: 500 });

    expect(moved.position).toBe(500);
    expect(moved.payload).toEqual(payload('body'));
    // Reorder still counts as a write: revision is the cursor, not updatedAt.
    expect(moved.revision).toBe(2);
  });

  it('rejects a stale revision and hands back the current row', async () => {
    const row = await add(ALICE, 'v1');
    await updateOtpRecord(ALICE, { id: row.id, expectedRevision: 1, payload: payload('v2') });

    try {
      await updateOtpRecord(ALICE, { id: row.id, expectedRevision: 1, payload: payload('racing') });
      throw new Error('expected a conflict');
    } catch (err) {
      expect(err).toBeInstanceOf(OtpConflictError);
      const conflict = err as OtpConflictError;
      expect(conflict.current).toMatchObject({ revision: 2 });
      expect(conflict.current?.payload).toEqual(payload('v2'));
      // The same object is what the tRPC error formatter puts on the wire.
      expect(conflict.conflictData).toBe(conflict.current);
    }
  });

  it('lets a tombstone beat an edit that was already in flight', async () => {
    const row = await add(ALICE, 'doomed');
    await deleteOtpRecord(ALICE, row.id, row.revision);

    try {
      await updateOtpRecord(ALICE, { id: row.id, expectedRevision: 1, payload: payload('too late') });
      throw new Error('expected a conflict');
    } catch (err) {
      expect((err as OtpConflictError).current?.deletedAt).toBeInstanceOf(Date);
    }

    // Crucially, the payload stayed null — the edit did not resurrect it.
    const [stored] = await listOtpRecords(ALICE);
    expect(stored.payload).toBeNull();
  });

  it('will not let one user write another’s record', async () => {
    const row = await add(BOB, 'bob');
    await expect(
      updateOtpRecord(ALICE, { id: row.id, expectedRevision: row.revision, payload: payload('stolen') }),
    ).rejects.toThrow(OtpConflictError);

    const [stored] = await listOtpRecords(BOB);
    expect(stored.payload).toEqual(payload('bob'));
  });

  it('rejects an unknown id', async () => {
    await expect(updateOtpRecord(ALICE, { id: uuidv7(), expectedRevision: 1, position: 1 })).rejects.toMatchObject({
      name: 'OtpConflictError',
      current: null,
    });
  });

  it('refuses an update with nothing in it rather than burning a revision', async () => {
    const row = await add(ALICE);
    await expect(updateOtpRecord(ALICE, { id: row.id, expectedRevision: 1 })).rejects.toThrow('nothing to update');
    expect((await listOtpRecords(ALICE))[0].revision).toBe(1);
  });
});

describe('deleteOtpRecord', () => {
  it('drops the payload but keeps the row as a tombstone', async () => {
    const row = await add(ALICE, 'secret');
    const tombstone = await deleteOtpRecord(ALICE, row.id, row.revision);

    expect(tombstone).toMatchObject({ id: row.id, payload: null, revision: 2 });
    expect(tombstone.deletedAt).toBeInstanceOf(Date);

    // The ciphertext is gone from the table, not merely hidden.
    const [stored] = await db.select().from(otpRecords).where(eq(otpRecords.id, row.id));
    expect(stored.payload).toBeNull();
  });

  it('rejects a stale revision', async () => {
    const row = await add(ALICE);
    await updateOtpRecord(ALICE, { id: row.id, expectedRevision: 1, position: 42 });
    await expect(deleteOtpRecord(ALICE, row.id, 1)).rejects.toThrow(OtpConflictError);
  });

  it('is not idempotent — a second delete conflicts rather than re-deleting', async () => {
    const row = await add(ALICE);
    await deleteOtpRecord(ALICE, row.id, row.revision);
    await expect(deleteOtpRecord(ALICE, row.id, row.revision)).rejects.toThrow(OtpConflictError);
  });

  it('will not let one user delete another’s record', async () => {
    const row = await add(BOB);
    await expect(deleteOtpRecord(ALICE, row.id, row.revision)).rejects.toThrow(OtpConflictError);
    expect((await listOtpRecords(BOB))[0].deletedAt).toBeNull();
  });
});

describe('reorderOtpRecords', () => {
  it('applies every position and bumps each revision', async () => {
    const a = await add(ALICE, 'a', 1000);
    const b = await add(ALICE, 'b', 2000);

    const rows = await reorderOtpRecords(ALICE, [
      { id: a.id, position: 2000 },
      { id: b.id, position: 1000 },
    ]);

    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(rows.every((r) => r.revision === 2)).toBe(true);
  });

  it('ignores ids belonging to another user', async () => {
    const mine = await add(ALICE, 'mine', 1000);
    const theirs = await add(BOB, 'theirs', 1000);

    await reorderOtpRecords(ALICE, [
      { id: mine.id, position: 5 },
      { id: theirs.id, position: 5 },
    ]);

    expect((await listOtpRecords(BOB))[0].position).toBe(1000);
  });

  it('skips tombstones', async () => {
    const row = await add(ALICE);
    await deleteOtpRecord(ALICE, row.id, row.revision);
    await reorderOtpRecords(ALICE, [{ id: row.id, position: 999 }]);

    const [stored] = await listOtpRecords(ALICE);
    expect(stored.position).toBe(1000);
  });
});

describe('purgeOtpTombstones', () => {
  const ageRow = async (id: string, ms: number) => {
    await db
      .update(otpRecords)
      .set({ deletedAt: new Date(Date.now() - ms) })
      .where(eq(otpRecords.id, id));
  };

  it('removes tombstones past the retention window and keeps the rest', async () => {
    const old = await add(ALICE, 'old', 1000);
    const recent = await add(ALICE, 'recent', 2000);
    const live = await add(ALICE, 'live', 3000);

    await deleteOtpRecord(ALICE, old.id, old.revision);
    await deleteOtpRecord(ALICE, recent.id, recent.revision);
    await ageRow(old.id, OTP_TOMBSTONE_RETENTION_MS + 60_000);
    await ageRow(recent.id, OTP_TOMBSTONE_RETENTION_MS - 60_000);

    const purged = await purgeOtpTombstones(new Date(Date.now() - OTP_TOMBSTONE_RETENTION_MS));
    expect(purged).toBe(1);

    const remaining = (await listOtpRecords(ALICE)).map((r) => r.id).sort();
    expect(remaining).toEqual([recent.id, live.id].sort());
  });

  it('never touches a live record', async () => {
    await add(ALICE, 'live');
    expect(await purgeOtpTombstones(new Date(Date.now() + 86_400_000))).toBe(0);
    expect(await listOtpRecords(ALICE)).toHaveLength(1);
  });
});

describe('erasure', () => {
  it('removes every row for the user, tombstones included, and no one else’s', async () => {
    const { eraseOtp } = await import('@/controllers/erase');

    const mine = await add(ALICE, 'live', 1000);
    const doomed = await add(ALICE, 'deleted', 2000);
    await deleteOtpRecord(ALICE, doomed.id, doomed.revision);
    await add(BOB, 'bob');

    await eraseOtp(ALICE);

    expect(await listOtpRecords(ALICE)).toHaveLength(0);
    expect(await listOtpRecords(BOB)).toHaveLength(1);
    // Nothing cascades from `users`, so this step is the only thing that would
    // have removed `mine` — a missing step leaves orphaned ciphertext behind.
    const rows = await db.select().from(otpRecords).where(eq(otpRecords.id, mine.id));
    expect(rows).toHaveLength(0);
  });
});

describe('the cleanup sweep', () => {
  it('purges aged OTP tombstones and reports the count', async () => {
    const { cleanupExpiredRows } = await import('@/controllers/cleanup');

    const row = await add(ALICE);
    await deleteOtpRecord(ALICE, row.id, row.revision);
    await db
      .update(otpRecords)
      .set({ deletedAt: new Date(Date.now() - OTP_TOMBSTONE_RETENTION_MS - 60_000) })
      .where(eq(otpRecords.id, row.id));

    const removed = await cleanupExpiredRows();
    expect(removed.otpRecords).toBe(1);
    expect(await listOtpRecords(ALICE)).toHaveLength(0);
  });

  it('leaves a fresh tombstone alone — an offline device still needs to see it', async () => {
    const { cleanupExpiredRows } = await import('@/controllers/cleanup');

    const row = await add(ALICE);
    await deleteOtpRecord(ALICE, row.id, row.revision);

    const removed = await cleanupExpiredRows();
    expect(removed.otpRecords).toBe(0);
    expect(await listOtpRecords(ALICE)).toHaveLength(1);
  });
});
