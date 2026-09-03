import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getDb } from '@/db/client';
import { desktopAuthAttempts } from '@/db/schema';

export const DESKTOP_ATTEMPT_TTL_MS = 5 * 60 * 1000;
export const DESKTOP_AUTH_CODE_TTL_MS = 60 * 1000;
export const DESKTOP_ATTEMPT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const DESKTOP_ATTEMPT_RATE_LIMIT_MAX = 10;
export const DESKTOP_EXCHANGE_ATTEMPT_MAX = 5;

export function hashDesktopAuthValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function canCreateDesktopAuthAttempt(ip: string): Promise<boolean> {
  if (!ip) return true;
  const windowStart = new Date(Date.now() - DESKTOP_ATTEMPT_RATE_LIMIT_WINDOW_MS);
  const rows = await getDb()
    .select({ n: count() })
    .from(desktopAuthAttempts)
    .where(and(eq(desktopAuthAttempts.ip, ip), gt(desktopAuthAttempts.createdAt, windowStart)));
  return Number(rows[0]?.n ?? 0) < DESKTOP_ATTEMPT_RATE_LIMIT_MAX;
}

export async function createDesktopAuthAttempt(params: { state: string; codeChallenge: string; ip: string }) {
  const expiresAt = new Date(Date.now() + DESKTOP_ATTEMPT_TTL_MS);
  const attemptId = randomBytes(24).toString('base64url');

  await getDb()
    .insert(desktopAuthAttempts)
    .values({
      attemptId,
      stateHash: hashDesktopAuthValue(params.state),
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      ip: params.ip,
      status: 'pending',
      expiresAt,
    });

  return { attemptId, expiresAt };
}

export async function authorizeDesktopAuthAttempt(params: { attemptId: string; state: string; userId: string }) {
  const db = getDb();
  const now = new Date();

  const found = await db
    .select()
    .from(desktopAuthAttempts)
    .where(
      and(
        eq(desktopAuthAttempts.attemptId, params.attemptId),
        eq(desktopAuthAttempts.status, 'pending'),
        gt(desktopAuthAttempts.expiresAt, now),
      ),
    )
    .limit(1);

  const attempt = found[0];
  if (!attempt || !safeEqual(attempt.stateHash, hashDesktopAuthValue(params.state))) return null;

  const authorizationCode = randomBytes(32).toString('base64url');
  const codeExpiresAt = new Date(Math.min(attempt.expiresAt.getTime(), now.getTime() + DESKTOP_AUTH_CODE_TTL_MS));

  // Re-assert `status = 'pending'` in the UPDATE so two concurrent authorize
  // calls can't both mint a code — only the first one matches.
  const authorized = await db
    .update(desktopAuthAttempts)
    .set({
      authorizationCodeHash: hashDesktopAuthValue(authorizationCode),
      userId: params.userId,
      status: 'authorized',
      authorizedAt: now,
      expiresAt: codeExpiresAt,
    })
    .where(
      and(
        eq(desktopAuthAttempts.attemptId, attempt.attemptId),
        eq(desktopAuthAttempts.status, 'pending'),
        gt(desktopAuthAttempts.expiresAt, now),
      ),
    )
    .returning({ attemptId: desktopAuthAttempts.attemptId });

  return authorized.length > 0 ? { authorizationCode, expiresAt: codeExpiresAt } : null;
}

export type ConsumeDesktopAuthResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid_or_expired' | 'rate_limited' | 'already_consumed' };

export async function consumeDesktopAuthAttempt(params: {
  attemptId: string;
  state: string;
  authorizationCode: string;
  codeVerifier: string;
}): Promise<ConsumeDesktopAuthResult> {
  const db = getDb();
  const now = new Date();

  // Burn one exchange attempt up front, atomically — a caller brute-forcing the
  // code must pay for every guess whether or not the credentials match.
  const claimed = await db
    .update(desktopAuthAttempts)
    .set({ exchangeAttempts: sql`${desktopAuthAttempts.exchangeAttempts} + 1` })
    .where(
      and(
        eq(desktopAuthAttempts.attemptId, params.attemptId),
        eq(desktopAuthAttempts.status, 'authorized'),
        gt(desktopAuthAttempts.expiresAt, now),
        lt(desktopAuthAttempts.exchangeAttempts, DESKTOP_EXCHANGE_ATTEMPT_MAX),
      ),
    )
    .returning();

  const candidate = claimed[0];
  if (!candidate) {
    const existing = await db
      .select()
      .from(desktopAuthAttempts)
      .where(eq(desktopAuthAttempts.attemptId, params.attemptId))
      .limit(1);
    if (existing[0]?.status === 'consumed') return { ok: false, reason: 'already_consumed' };
    if (existing[0] && existing[0].exchangeAttempts >= DESKTOP_EXCHANGE_ATTEMPT_MAX) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: false, reason: 'invalid_or_expired' };
  }

  const expectedChallenge = createHash('sha256').update(params.codeVerifier, 'utf8').digest('base64url');
  const credentialsMatch =
    safeEqual(candidate.stateHash, hashDesktopAuthValue(params.state)) &&
    safeEqual(candidate.authorizationCodeHash ?? '', hashDesktopAuthValue(params.authorizationCode)) &&
    safeEqual(candidate.codeChallenge, expectedChallenge);

  if (!credentialsMatch || !candidate.userId) return { ok: false, reason: 'invalid_or_expired' };

  const consumed = await db
    .update(desktopAuthAttempts)
    .set({ status: 'consumed', consumedAt: now })
    .where(
      and(
        eq(desktopAuthAttempts.attemptId, candidate.attemptId),
        eq(desktopAuthAttempts.status, 'authorized'),
        gt(desktopAuthAttempts.expiresAt, now),
      ),
    )
    .returning({ attemptId: desktopAuthAttempts.attemptId });

  return consumed.length > 0 ? { ok: true, userId: candidate.userId } : { ok: false, reason: 'already_consumed' };
}
