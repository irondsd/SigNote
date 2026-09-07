import { and, count, eq, gt, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { passkeyChallenges, type PasskeyChallengeKind } from '@/db/schema';

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_MAX = Number(process.env.PASSKEY_CHALLENGE_MAX_PER_IP ?? 10);

export async function checkChallengeRateLimit(ip: string): Promise<boolean> {
  if (!ip) return true;
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const rows = await getDb()
    .select({ n: count() })
    .from(passkeyChallenges)
    .where(and(eq(passkeyChallenges.ip, ip), gt(passkeyChallenges.createdAt, since)));
  return Number(rows[0].n) < RATE_LIMIT_MAX;
}

export async function createChallenge(params: {
  challenge: string;
  kind: PasskeyChallengeKind;
  userId: string | null;
  ip: string;
}) {
  const now = new Date();
  await getDb()
    .insert(passkeyChallenges)
    .values({
      challenge: params.challenge,
      kind: params.kind,
      userId: params.userId,
      ip: params.ip,
      expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
    });
}

export type PasskeyChallengeRow = typeof passkeyChallenges.$inferSelect;

/** Atomically burns a matching challenge. Failed verification still consumes it. */
export async function consumeChallenge(params: {
  challenge: string;
  kind: PasskeyChallengeKind;
  /** Undefined accepts either binding; null explicitly requires an unbound row. */
  userId?: string | null;
}): Promise<PasskeyChallengeRow | null> {
  const now = new Date();
  const userPredicate =
    params.userId === undefined
      ? undefined
      : params.userId === null
        ? isNull(passkeyChallenges.userId)
        : eq(passkeyChallenges.userId, params.userId);
  const rows = await getDb()
    .update(passkeyChallenges)
    .set({ usedAt: now })
    .where(
      and(
        eq(passkeyChallenges.challenge, params.challenge),
        eq(passkeyChallenges.kind, params.kind),
        isNull(passkeyChallenges.usedAt),
        gt(passkeyChallenges.expiresAt, now),
        userPredicate,
      ),
    )
    .returning();
  return rows[0] ?? null;
}
