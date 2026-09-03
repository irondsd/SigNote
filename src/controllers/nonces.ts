import { and, count, eq, gt, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authNonces } from '@/db/schema';

const NONCE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

export const checkNonceRateLimit = async (ip: string): Promise<boolean> => {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const rows = await getDb()
    .select({ n: count() })
    .from(authNonces)
    .where(and(eq(authNonces.ip, ip), gt(authNonces.createdAt, windowStart)));
  return Number(rows[0].n) < RATE_LIMIT_MAX;
};

export const createNonceRecord = async (nonce: string, ip?: string) => {
  const now = new Date();
  await getDb()
    .insert(authNonces)
    .values({
      nonce,
      usedAt: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
      ip,
    });
};

export type NonceRow = typeof authNonces.$inferSelect;

/** Atomically marks an unused, unexpired nonce as consumed. Null when the
 *  nonce is unknown, already used, or expired. */
export const consumeNonceRecord = async (nonce: string): Promise<NonceRow | null> => {
  const now = new Date();
  const rows = await getDb()
    .update(authNonces)
    .set({ usedAt: now })
    .where(and(eq(authNonces.nonce, nonce), isNull(authNonces.usedAt), gt(authNonces.expiresAt, now)))
    .returning();
  return rows[0] ?? null;
};
