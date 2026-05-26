import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AuthSessionModel } from '@/models/AuthSession';
import {
  SESSION_LIFETIME_MS,
  findSessionForValidation,
  listUserSessions,
  revokeAllOtherSessions,
  revokeSession,
  revokeSessionBySid,
  touchSession,
  upsertSessionIfMissing,
} from '../authSessions';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await AuthSessionModel.deleteMany({});
});

const userId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439012';

const makeSid = () => new mongoose.Types.ObjectId().toString();

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
      const row = await AuthSessionModel.findById(params.sid).lean();
      expect(row).not.toBeNull();
      expect(row?.userId).toBe(userId);
      expect(row?.revokedAt).toBeNull();
      expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not overwrite an existing revoked row', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      await revokeSession(params.sid, userId);

      // Second upsert with same sid — must not undo the revoke.
      await upsertSessionIfMissing({ ...params, ip: '9.9.9.9' });

      const row = await AuthSessionModel.findById(params.sid).lean();
      expect(row?.revokedAt).not.toBeNull();
      expect(row?.ip).toBe('1.2.3.4'); // original, not overwritten
    });

    it('silently ignores malformed sids', async () => {
      await upsertSessionIfMissing(insertParams({ sid: 'not-an-objectid' }));
      const count = await AuthSessionModel.countDocuments();
      expect(count).toBe(0);
    });
  });

  describe('findSessionForValidation', () => {
    it('returns null for unknown sid', async () => {
      const row = await findSessionForValidation(makeSid());
      expect(row).toBeNull();
    });

    it('returns null for malformed sid', async () => {
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
      const before = await AuthSessionModel.findById(params.sid).lean();

      // Force updatedAt into the past so the touch is observable
      const past = new Date(Date.now() - 10 * 60 * 1000);
      await AuthSessionModel.updateOne({ _id: params.sid }, { $set: { updatedAt: past, expiresAt: past } });

      await touchSession(params.sid, '5.6.7.8', 'NewUA');

      const after = await AuthSessionModel.findById(params.sid).lean();
      expect(after?.updatedAt.getTime()).toBeGreaterThan(before!.createdAt.getTime());
      expect(after?.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_LIFETIME_MS - 1000);
      expect(after?.ip).toBe('5.6.7.8');
      expect(after?.userAgent).toBe('NewUA');
    });

    it('does not touch a revoked row', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      await revokeSession(params.sid, userId);
      const before = await AuthSessionModel.findById(params.sid).lean();

      await touchSession(params.sid, '5.6.7.8', 'NewUA');

      const after = await AuthSessionModel.findById(params.sid).lean();
      expect(after?.ip).toBe(before?.ip);
    });
  });

  describe('listUserSessions', () => {
    it('only returns the requesting user, non-revoked, non-expired', async () => {
      const mine1 = insertParams();
      const mine2 = insertParams();
      const theirs = insertParams({ userId: otherUserId });
      await Promise.all([
        upsertSessionIfMissing(mine1),
        upsertSessionIfMissing(mine2),
        upsertSessionIfMissing(theirs),
      ]);

      // Revoke one of mine, expire another
      await revokeSession(mine2.sid, userId);

      const list = await listUserSessions(userId);
      expect(list).toHaveLength(1);
      expect(list[0]._id.toString()).toBe(mine1.sid);
    });

    it('hides sessions whose expiresAt is in the past', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);
      await AuthSessionModel.updateOne({ _id: params.sid }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

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

      const row = await AuthSessionModel.findById(params.sid).lean();
      expect(row?.revokedAt).not.toBeNull();
    });

    it('refuses to revoke a session owned by someone else', async () => {
      const params = insertParams({ userId: otherUserId });
      await upsertSessionIfMissing(params);

      const ok = await revokeSession(params.sid, userId);
      expect(ok).toBe(false);

      const row = await AuthSessionModel.findById(params.sid).lean();
      expect(row?.revokedAt).toBeNull();
    });

    it('returns false on a non-existent session', async () => {
      const ok = await revokeSession(makeSid(), userId);
      expect(ok).toBe(false);
    });

    it('returns false on a malformed id', async () => {
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

      const count = await revokeAllOtherSessions(userId, keep.sid);
      expect(count).toBe(2);

      const list = await listUserSessions(userId);
      expect(list).toHaveLength(1);
      expect(list[0]._id.toString()).toBe(keep.sid);

      // Other user untouched
      const theirsRow = await AuthSessionModel.findById(theirs.sid).lean();
      expect(theirsRow?.revokedAt).toBeNull();
    });
  });

  describe('revokeSessionBySid', () => {
    it('revokes by sid regardless of user (used by signOut event)', async () => {
      const params = insertParams();
      await upsertSessionIfMissing(params);

      await revokeSessionBySid(params.sid);

      const row = await AuthSessionModel.findById(params.sid).lean();
      expect(row?.revokedAt).not.toBeNull();
    });

    it('is a no-op for malformed sids', async () => {
      await expect(revokeSessionBySid('garbage')).resolves.toBeUndefined();
    });
  });
});
