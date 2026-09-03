import { count, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Db } from '@/db/client';
import { authSessions } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import {
  SESSION_LIFETIME_MS,
  findSessionForValidation,
  listUserSessions,
  revokeAllOtherSessions,
  revokeSession,
  revokeSessionBySid,
  touchSession,
  upsertSessionIfMissing,
} from '@/controllers/authSessions';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

const userId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439012';

const makeSid = () => uuidv7();

const getRow = async (sid: string) => {
  const rows = await db.select().from(authSessions).where(eq(authSessions.id, sid));
  return rows[0] ?? null;
};

const countRows = async () => {
  const rows = await db.select({ n: count() }).from(authSessions);
  return Number(rows[0].n);
};

const insertParams = (overrides: Partial<Parameters<typeof upsertSessionIfMissing>[0]> = {}) => ({
  sid: makeSid(),
  userId,
  provider: 'google' as const,
  ip: '1.2.3.4',
  userAgent: 'UA',
  browser: 'Chrome 120',
  os: 'macOS 14',
  deviceType: 'desktop' as const,
  ...overrides,
});

describe('authSessions controller', () => {
  describe('upsertSessionIfMissing', () => {
    it('creates a row when none exists', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      const row = await getRow(params.sid);
      expect(row).not.toBeNull();
      expect(row?.userId).toBe(userId);
      expect(row?.revokedAt).toBeNull();
      expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not overwrite an existing revoked row', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      await revokeSession(params.sid, userId);

      // Second upsert with same sid — must not undo the revoke.
      await upsertSessionIfMissing({ ...params, ip: '9.9.9.9' });

      const row = await getRow(params.sid);
      expect(row?.revokedAt).not.toBeNull();
      expect(row?.ip).toBe('1.2.3.4'); // original, not overwritten
    });

    it('silently ignores an empty sid', async () => {
      await upsertSessionIfMissing(insertParams({ sid: '' }));
      expect(await countRows()).toBe(0);
    });
  });

  describe('findSessionForValidation', () => {
    it('returns null for unknown sid', async () => {
      const row = await findSessionForValidation(makeSid());
      expect(row).toBeNull();
    });

    it('returns null for a garbage sid', async () => {
      const row = await findSessionForValidation('garbage');
      expect(row).toBeNull();
    });

    it('returns the row for an existing sid', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      const row = await findSessionForValidation(params.sid);
      expect(row?.userId).toBe(userId);
    });
  });

  describe('touchSession', () => {
    it('updates updatedAt and extends expiresAt', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      const before = await getRow(params.sid);

      // Force updatedAt into the past so the touch is observable
      const past = new Date(Date.now() - 10 * 60 * 1000);
      await db.update(authSessions).set({ updatedAt: past, expiresAt: past }).where(eq(authSessions.id, params.sid));

      await touchSession(params.sid, '5.6.7.8', 'NewUA');

      const after = await getRow(params.sid);
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.createdAt.getTime());
      expect(after!.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_LIFETIME_MS - 1000);
      expect(after?.ip).toBe('5.6.7.8');
      expect(after?.userAgent).toBe('NewUA');
    });

    it('does not touch a revoked row', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      await revokeSession(params.sid, userId);
      const before = await getRow(params.sid);

      await touchSession(params.sid, '5.6.7.8', 'NewUA');

      const after = await getRow(params.sid);
      expect(after?.ip).toBe(before?.ip);
    });
  });

  describe('listUserSessions', () => {
    it('only returns the requesting user, non-revoked, non-expired', async () => {
      const mine1 = insertParams();
      const mine2 = insertParams();
      const theirs = insertParams({ userId: otherUserId });
      await Promise.all([upsertSessionIfMissing(mine1), upsertSessionIfMissing(mine2), upsertSessionIfMissing(theirs)]);

      // Revoke one of mine
      await revokeSession(mine2.sid, userId);

      const list = await listUserSessions(userId);
      expect(list).toHaveLength(1);
      expect(list[0]._id.toString()).toBe(mine1.sid);
    });

    it('hides sessions whose expiresAt is in the past', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      await db
        .update(authSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(authSessions.id, params.sid));

      const list = await listUserSessions(userId);
      expect(list).toHaveLength(0);
    });
  });

  describe('revokeSession', () => {
    it('revokes a session owned by the user', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);

      const ok = await revokeSession(params.sid, userId);
      expect(ok).toBe(true);

      const row = await getRow(params.sid);
      expect(row?.revokedAt).not.toBeNull();
    });

    it('refuses to revoke a session owned by someone else', async () => {
      const params = insertParams({ userId: otherUserId });
      await upsertSessionIfMissing(params);

      const ok = await revokeSession(params.sid, userId);
      expect(ok).toBe(false);

      const row = await getRow(params.sid);
      expect(row?.revokedAt).toBeNull();
    });

    it('returns false on a non-existent session', async () => {
      const ok = await revokeSession(makeSid(), userId);
      expect(ok).toBe(false);
    });

    it('returns false on a garbage id', async () => {
      const ok = await revokeSession('garbage', userId);
      expect(ok).toBe(false);
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('revokes every other session for the user, not the kept one', async () => {
      const keep = insertParams();
      const a = insertParams();
      const b = insertParams();
      const theirs = insertParams({ userId: otherUserId });
      await Promise.all([keep, a, b, theirs].map(upsertSessionIfMissing));

      const revoked = await revokeAllOtherSessions(userId, keep.sid);
      expect(revoked).toBe(2);

      const list = await listUserSessions(userId);
      expect(list).toHaveLength(1);
      expect(list[0]._id.toString()).toBe(keep.sid);

      // Other user untouched
      const theirsRow = await getRow(theirs.sid);
      expect(theirsRow?.revokedAt).toBeNull();
    });
  });

  describe('revokeSessionBySid', () => {
    it('revokes by sid regardless of user (used by signOut event)', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);

      await revokeSessionBySid(params.sid);

      const row = await getRow(params.sid);
      expect(row?.revokedAt).not.toBeNull();
    });

    it('is a no-op for unknown sids', async () => {
      await expect(revokeSessionBySid('garbage')).resolves.toBeUndefined();
    });
  });
});
