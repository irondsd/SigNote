import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authSessions, type AuthClient, type AuthProvider, type DeviceType } from '@/db/schema';

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

type RawSession = typeof authSessions.$inferSelect;

const mapSession = ({ id, ...rest }: RawSession): SessionRow => ({ _id: id, ...rest });

/**
 * Lazily create an auth-session row the first time a freshly issued JWT hits
 * an authenticated route. Never overwrites an existing row (e.g. one that's
 * been revoked) — ON CONFLICT DO NOTHING is the contract.
 */
export const upsertSessionIfMissing = async (params: {
  sid: string;
  userId: string;
  provider: AuthProvider;
  client?: AuthClient;
  ip: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
}): Promise<boolean> => {
  if (!params.sid) return false;
  const inserted = await getDb()
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
  // not a new sign-in. Callers use this to decide whether to alert.
  return inserted.length > 0;
};

/** Cheap PK lookup used on every authed request. */
export const findSessionForValidation = async (sid: string): Promise<SessionRow | null> => {
  if (!sid) return null;
  const rows = await getDb().select().from(authSessions).where(eq(authSessions.id, sid)).limit(1);
  return rows[0] ? mapSession(rows[0]) : null;
};

/**
 * Sliding-window touch: extends expiresAt and refreshes ip/userAgent. Caller
 * is expected to throttle (only touch when updatedAt > TOUCH_THROTTLE_MS old)
 * so we don't write on every request.
 */
export const touchSession = async (sid: string, ip: string, userAgent: string) => {
  if (!sid) return;
  const now = new Date();
  await getDb()
    .update(authSessions)
    .set({
      ip,
      userAgent,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    })
    .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)));
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
  const rows = await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  return rows.length > 0;
};

/** Revokes every non-revoked session for `userId` except `exceptSid`. Returns count revoked. */
export const revokeAllOtherSessions = async (userId: string, exceptSid: string): Promise<number> => {
  const rows = await getDb()
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
  return rows.length;
};

/** Used by NextAuth's signOut event (via the internal API). Idempotent. */
export const revokeSessionBySid = async (sid: string) => {
  if (!sid) return;
  await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)));
};
