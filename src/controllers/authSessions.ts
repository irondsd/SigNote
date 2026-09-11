import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { withAccountLock, type EncryptionState } from '@/db/encryptionState';
import { authSessions, encryptionStates, type AuthClient, type AuthProvider, type DeviceType } from '@/db/schema';

export type { AuthClient, AuthProvider, DeviceType };

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

export type SessionRow = {
  _id: string;
  userId: string;
  provider: AuthProvider;
  client: AuthClient;
  ip: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

/**
 * The epoch claim is deliberately tri-state at the trust boundary:
 * `undefined` means a legacy token without the claim, `number` is a valid
 * claim, and `null` means a claim was present but malformed. A malformed
 * signed token must fail closed rather than being treated like a legacy one.
 */
export type SessionEpochClaim = number | null | undefined;

export type SessionValidationContext = {
  userId: string | null | undefined;
  sessionEpoch: SessionEpochClaim;
};

/** A session could not be admitted under the account's current epoch fence. */
export class SessionEpochError extends Error {
  constructor(message = 'Session epoch is no longer valid') {
    super(message);
    this.name = 'SessionEpochError';
  }
}

type RawSession = typeof authSessions.$inferSelect;

const mapSession = ({ id, ...rest }: RawSession): SessionRow => ({ _id: id, ...rest });

/**
 * Returns whether a signed session claim is compatible with the durable
 * account state. The explicit survivor is the only exception to an older
 * epoch, and is also the only exception for a legacy token with no epoch.
 */
export const isSessionEpochAllowed = (
  state: Pick<EncryptionState, 'sessionEpoch' | 'survivingSid'>,
  sid: string,
  sessionEpoch: SessionEpochClaim,
): boolean => {
  if (!sid || sessionEpoch === null) return false;
  if (state.survivingSid === sid) return true;
  if (sessionEpoch === undefined) return state.sessionEpoch === 0;
  return sessionEpoch === state.sessionEpoch;
};

/**
 * Captures the epoch at initial sign-in under the same account lock used by
 * revocation. The optional sid is persisted in the rotation marker so a new
 * sign-in invalidates an in-progress rotation prerequisite immediately.
 */
export const captureSessionEpoch = async (userId: string, sid: string): Promise<number> =>
  withAccountLock(userId, async (db, state) => {
    if (!sid) throw new SessionEpochError('Session id is required');
    await db.update(encryptionStates).set({ rotationSessionSid: null }).where(eq(encryptionStates.userId, userId));
    return state.sessionEpoch;
  });

const isDeadSession = (row: Pick<SessionRow, 'revokedAt' | 'expiresAt'>): boolean =>
  row.revokedAt !== null || row.expiresAt.getTime() <= Date.now();

/**
 * Lazily create an auth-session row the first time a freshly issued JWT hits
 * an authenticated route. Never overwrites an existing row (e.g. one that's
 * been revoked) — ON CONFLICT DO NOTHING is the contract.
 */
export const upsertSessionIfMissing = async (params: {
  sid: string;
  userId: string;
  sessionEpoch?: SessionEpochClaim;
  provider: AuthProvider;
  client?: AuthClient;
  ip: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
}): Promise<boolean> => {
  if (!params.sid) return false;
  return withAccountLock(params.userId, async (db, state) => {
    // Re-read inside the account transaction. The initial request validation
    // may have observed a missing row just before revokeAllOtherSessions took
    // the lock; this second check is what prevents that old token from being
    // resurrected after revocation.
    const existing = await db.select().from(authSessions).where(eq(authSessions.id, params.sid)).limit(1);
    const row = existing[0];
    if (row) {
      if (row.userId !== params.userId || isDeadSession(row)) throw new SessionEpochError();
      if (!isSessionEpochAllowed(state, params.sid, params.sessionEpoch)) throw new SessionEpochError();
      return false;
    }

    // Once an epoch has been advanced, a surviving sid is expected to have a
    // live audit row. Treat a missing row as revoked so cleanup or an external
    // delete can never turn the durable survivor exception into a resurrection
    // path.
    if (state.sessionEpoch > 0 && state.survivingSid === params.sid) throw new SessionEpochError();
    if (!isSessionEpochAllowed(state, params.sid, params.sessionEpoch)) throw new SessionEpochError();

    const inserted = await db
      .insert(authSessions)
      .values({
        id: params.sid,
        userId: params.userId,
        provider: params.provider,
        client: params.client ?? 'web',
        ip: params.ip,
        userAgent: params.userAgent,
        browser: params.browser,
        os: params.os,
        deviceType: params.deviceType,
        revokedAt: null,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      })
      .onConflictDoNothing()
      .returning({ id: authSessions.id });

    // Empty means the row was already there — a retry or a concurrent request,
    // not a new sign-in. The account lock serializes normal same-user retries;
    // an unrelated pre-existing row is rejected by the next request validation.
    return inserted.length > 0;
  });
};

/** Cheap PK lookup used on every authed request. */
export const findSessionForValidation = async (sid: string): Promise<SessionRow | null> => {
  if (!sid) return null;
  const rows = await getDb().select().from(authSessions).where(eq(authSessions.id, sid)).limit(1);
  return rows[0] ? mapSession(rows[0]) : null;
};

/**
 * Sliding-window touch: extends expiresAt and refreshes request metadata.
 * Callers normally throttle this (updatedAt > TOUCH_THROTTLE_MS old); the
 * one-time web-to-PWA promotion is intentionally written immediately.
 */
export const touchSession = async (sid: string, ip: string, userAgent: string, client?: AuthClient) => {
  if (!sid) return;
  const now = new Date();
  await getDb()
    .update(authSessions)
    .set({
      ip,
      userAgent,
      ...(client ? { client } : {}),
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    })
    .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)));
};

export const listUserSessions = async (userId: string): Promise<SessionRow[]> => {
  const rows = await getDb()
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
    .orderBy(desc(authSessions.updatedAt));
  return rows.map(mapSession);
};

/** Returns true if a non-revoked row matching (id, userId) existed and was revoked. */
export const revokeSession = async (sessionId: string, userId: string): Promise<boolean> => {
  if (!sessionId) return false;
  return withAccountLock(userId, async (db) => {
    const rows = await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    if (rows.length > 0) {
      await db
        .update(encryptionStates)
        .set({ survivingSid: null, rotationSessionSid: null })
        .where(and(eq(encryptionStates.userId, userId), eq(encryptionStates.survivingSid, sessionId)));
    }
    return rows.length > 0;
  });
};

/** Revokes every non-revoked session for `userId` except `exceptSid`. Returns count revoked. */
export const revokeAllOtherSessions = async (userId: string, exceptSid: string): Promise<number> => {
  return withAccountLock(userId, async (db, state) => {
    const rows = await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          ...(exceptSid ? [ne(authSessions.id, exceptSid)] : []),
        ),
      )
      .returning({ id: authSessions.id });

    // Advance the epoch in the same transaction as the row revocations. A
    // request that saw the old epoch can therefore never lazily create a row
    // after this point. The survivor exception is durable until that row is
    // explicitly revoked or a later revoke-all replaces it.
    await db
      .update(encryptionStates)
      .set({
        sessionEpoch: state.sessionEpoch + 1,
        survivingSid: exceptSid || null,
        rotationSessionSid: exceptSid || null,
      })
      .where(eq(encryptionStates.userId, userId));
    return rows.length;
  });
};

/** Used by NextAuth's signOut event (via the internal API). Idempotent. */
export const revokeSessionBySid = async (sid: string) => {
  if (!sid) return;
  const found = await getDb()
    .select({ userId: authSessions.userId })
    .from(authSessions)
    .where(eq(authSessions.id, sid))
    .limit(1);
  const userId = found[0]?.userId;
  if (!userId) return;
  await withAccountLock(userId, async (db) => {
    const rows = await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    if (rows.length > 0) {
      await db
        .update(encryptionStates)
        .set({ survivingSid: null, rotationSessionSid: null })
        .where(and(eq(encryptionStates.userId, userId), eq(encryptionStates.survivingSid, sid)));
    }
  });
};
