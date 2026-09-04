import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { emailSignInCodes } from '@/db/schema';
import { normalizeEmail } from './userEmail';

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
/** Wrong guesses allowed against one code before it is dead. */
const MAX_ATTEMPTS = 5;
/**
 * Codes one address may request per window, and the window.
 *
 * The per-IP cap is overridable because the E2E suite drives every account from
 * one address and would otherwise exhaust a shared quota; the limiter itself is
 * covered by unit tests. Never set in production.
 */
const MAX_PER_EMAIL = Number(process.env.EMAIL_CODE_MAX_PER_EMAIL ?? 5);
const MAX_PER_IP = Number(process.env.EMAIL_CODE_MAX_PER_IP ?? 20);
const RATE_WINDOW_MINUTES = 15;

/**
 * Peppered with `NEXTAUTH_SECRET` rather than plainly hashed: six digits is a
 * space an attacker with the table could exhaust in microseconds, and the
 * pepper lives outside the database.
 */
const hashCode = (code: string): string =>
  createHmac('sha256', process.env.NEXTAUTH_SECRET ?? 'signote-dev-secret')
    .update(code)
    .digest('hex');

const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Uniform over the whole range — `Math.random()` is not, and this is a credential. */
const generateCode = (): string =>
  randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, '0');

const windowStart = () => new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000);

export type RequestOutcome =
  { ok: true; code: string; expiresInMinutes: number } | { ok: false; reason: 'rate-limited' };

/**
 * Issues a code for an address, retiring any earlier unused one.
 *
 * Note what this does *not* do: it never says whether an account exists. A code
 * both signs in and creates, so the two cases are genuinely identical and there
 * is no enumeration signal to leak.
 */
export const requestSignInCode = async (params: { email: string; ip: string }): Promise<RequestOutcome> => {
  const email = normalizeEmail(params.email);
  const db = getDb();
  const since = windowStart();

  const [byEmail, byIp] = await Promise.all([
    db
      .select({ n: count() })
      .from(emailSignInCodes)
      .where(and(eq(emailSignInCodes.email, email), gt(emailSignInCodes.createdAt, since))),
    params.ip
      ? db
          .select({ n: count() })
          .from(emailSignInCodes)
          .where(and(eq(emailSignInCodes.ip, params.ip), gt(emailSignInCodes.createdAt, since)))
      : Promise.resolve([{ n: 0 }]),
  ]);

  if (Number(byEmail[0].n) >= MAX_PER_EMAIL || Number(byIp[0].n) >= MAX_PER_IP) {
    return { ok: false, reason: 'rate-limited' };
  }

  // One live code per address: requesting a new one must invalidate the old,
  // or every request widens the window an attacker is guessing against.
  await db
    .update(emailSignInCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(emailSignInCodes.email, email), isNull(emailSignInCodes.consumedAt)));

  const code = generateCode();
  await db.insert(emailSignInCodes).values({
    email,
    codeHash: hashCode(code),
    ip: params.ip,
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
  });

  return { ok: true, code, expiresInMinutes: CODE_TTL_MINUTES };
};

export type ConsumeOutcome = 'ok' | 'invalid' | 'expired' | 'too-many-attempts';

/**
 * Checks a code and burns it. A correct code is single-use; a wrong one costs
 * an attempt against the row, and the fifth kills it.
 *
 * Every failure mode returns the same shape on purpose — the caller must not
 * tell the user which of "wrong code", "expired" or "no code was requested"
 * happened, since the difference is only useful to someone guessing.
 */
export const consumeSignInCode = async (params: { email: string; code: string }): Promise<ConsumeOutcome> => {
  const email = normalizeEmail(params.email);
  const db = getDb();

  const rows = await db
    .select()
    .from(emailSignInCodes)
    .where(and(eq(emailSignInCodes.email, email), isNull(emailSignInCodes.consumedAt)))
    .orderBy(sql`${emailSignInCodes.createdAt} desc`)
    .limit(1);

  const row = rows[0];
  if (!row) return 'invalid';
  if (row.expiresAt.getTime() < Date.now()) return 'expired';
  if (row.attempts >= MAX_ATTEMPTS) return 'too-many-attempts';

  if (!constantTimeEquals(row.codeHash, hashCode(params.code))) {
    const attempts = row.attempts + 1;
    await db.update(emailSignInCodes).set({ attempts }).where(eq(emailSignInCodes.id, row.id));
    return attempts >= MAX_ATTEMPTS ? 'too-many-attempts' : 'invalid';
  }

  await db.update(emailSignInCodes).set({ consumedAt: new Date() }).where(eq(emailSignInCodes.id, row.id));
  return 'ok';
};
