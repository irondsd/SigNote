import mongoose from 'mongoose';

import { AuthSessionModel, type AuthProvider, type DeviceType } from '@/models/AuthSession';

// Controller intentionally does not call connectToDatabase: callers (route
// handlers via withSession; tests via mongoose.connect) own the connection
// lifecycle. Matches the pattern used by src/controllers/files.ts.

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

const toObjectId = (id: string): mongoose.Types.ObjectId | null => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

/**
 * Lazily create an auth-session row the first time a freshly issued JWT hits
 * an authenticated route. Never overwrites an existing row (e.g. one that's
 * been revoked) — `$setOnInsert` is the contract.
 */
export const upsertSessionIfMissing = async (params: {
  sid: string;
  userId: string;
  provider: AuthProvider;
  ip: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
}) => {
  const _id = toObjectId(params.sid);
  if (!_id) return;
  // createdAt/updatedAt are populated by mongoose's `timestamps: true` on
  // insert — don't set them here or it conflicts with mongoose's own $set.
  await AuthSessionModel.updateOne(
    { _id },
    {
      $setOnInsert: {
        _id,
        userId: params.userId,
        provider: params.provider,
        ip: params.ip,
        userAgent: params.userAgent,
        browser: params.browser,
        os: params.os,
        deviceType: params.deviceType,
        revokedAt: null,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      },
    },
    { upsert: true },
  );
};

/** Cheap _id-keyed lookup used on every authed request. */
export const findSessionForValidation = async (sid: string) => {
  const _id = toObjectId(sid);
  if (!_id) return null;
  return AuthSessionModel.findById(_id).lean().exec();
};

/**
 * Sliding-window touch: extends expiresAt and refreshes ip/userAgent. Caller
 * is expected to throttle (only touch when updatedAt > TOUCH_THROTTLE_MS old)
 * so we don't write on every request.
 */
export const touchSession = async (sid: string, ip: string, userAgent: string) => {
  const _id = toObjectId(sid);
  if (!_id) return;
  const now = new Date();
  await AuthSessionModel.updateOne(
    { _id, revokedAt: null },
    {
      $set: {
        ip,
        userAgent,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      },
    },
  );
};

export const listUserSessions = async (userId: string) => {
  return AuthSessionModel.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ updatedAt: -1 })
    .lean()
    .exec();
};

/** Returns true if a non-revoked row matching (id, userId) existed and was revoked. */
export const revokeSession = async (sessionId: string, userId: string): Promise<boolean> => {
  const _id = toObjectId(sessionId);
  if (!_id) return false;
  const res = await AuthSessionModel.updateOne(
    { _id, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return res.matchedCount > 0;
};

/** Revokes every non-revoked session for `userId` except `exceptSid`. Returns count revoked. */
export const revokeAllOtherSessions = async (userId: string, exceptSid: string): Promise<number> => {
  const _id = toObjectId(exceptSid);
  const res = await AuthSessionModel.updateMany(
    {
      userId,
      revokedAt: null,
      ...(_id ? { _id: { $ne: _id } } : {}),
    },
    { $set: { revokedAt: new Date() } },
  );
  return res.modifiedCount;
};

/** Used by NextAuth's signOut event. Idempotent. */
export const revokeSessionBySid = async (sid: string) => {
  const _id = toObjectId(sid);
  if (!_id) return;
  await AuthSessionModel.updateOne({ _id, revokedAt: null }, { $set: { revokedAt: new Date() } });
};
