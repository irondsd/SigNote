import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DesktopAuthAttemptModel } from '@/models/DesktopAuthAttempt';

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
  const count = await DesktopAuthAttemptModel.countDocuments({ ip, createdAt: { $gt: windowStart } });
  return count < DESKTOP_ATTEMPT_RATE_LIMIT_MAX;
}

export async function createDesktopAuthAttempt(params: { state: string; codeChallenge: string; ip: string }) {
  const now = new Date();
  const attemptId = randomBytes(24).toString('base64url');

  await DesktopAuthAttemptModel.create({
    attemptId,
    stateHash: hashDesktopAuthValue(params.state),
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: 'S256',
    ip: params.ip,
    status: 'pending',
    expiresAt: new Date(now.getTime() + DESKTOP_ATTEMPT_TTL_MS),
  });

  return { attemptId, expiresAt: new Date(now.getTime() + DESKTOP_ATTEMPT_TTL_MS) };
}

export async function authorizeDesktopAuthAttempt(params: { attemptId: string; state: string; userId: string }) {
  const now = new Date();
  const attempt = await DesktopAuthAttemptModel.findOne({
    attemptId: params.attemptId,
    status: 'pending',
    expiresAt: { $gt: now },
  })
    .lean()
    .exec();

  if (!attempt || !safeEqual(attempt.stateHash, hashDesktopAuthValue(params.state))) return null;

  const authorizationCode = randomBytes(32).toString('base64url');
  const codeExpiresAt = new Date(Math.min(attempt.expiresAt.getTime(), now.getTime() + DESKTOP_AUTH_CODE_TTL_MS));
  const authorized = await DesktopAuthAttemptModel.findOneAndUpdate(
    { _id: attempt._id, status: 'pending', expiresAt: { $gt: now } },
    {
      $set: {
        authorizationCodeHash: hashDesktopAuthValue(authorizationCode),
        userId: params.userId,
        status: 'authorized',
        authorizedAt: now,
        expiresAt: codeExpiresAt,
      },
    },
    { returnDocument: 'after' },
  )
    .lean()
    .exec();

  return authorized ? { authorizationCode, expiresAt: codeExpiresAt } : null;
}

export type ConsumeDesktopAuthResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid_or_expired' | 'rate_limited' | 'already_consumed' };

export async function consumeDesktopAuthAttempt(params: {
  attemptId: string;
  state: string;
  authorizationCode: string;
  codeVerifier: string;
}): Promise<ConsumeDesktopAuthResult> {
  const now = new Date();
  const candidate = await DesktopAuthAttemptModel.findOneAndUpdate(
    {
      attemptId: params.attemptId,
      status: 'authorized',
      expiresAt: { $gt: now },
      exchangeAttempts: { $lt: DESKTOP_EXCHANGE_ATTEMPT_MAX },
    },
    { $inc: { exchangeAttempts: 1 } },
    { returnDocument: 'after' },
  )
    .lean()
    .exec();

  if (!candidate) {
    const existing = await DesktopAuthAttemptModel.findOne({ attemptId: params.attemptId }).lean().exec();
    if (existing?.status === 'consumed') return { ok: false, reason: 'already_consumed' };
    if (existing && existing.exchangeAttempts >= DESKTOP_EXCHANGE_ATTEMPT_MAX) {
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

  const consumed = await DesktopAuthAttemptModel.findOneAndUpdate(
    { _id: candidate._id, status: 'authorized', expiresAt: { $gt: now } },
    { $set: { status: 'consumed', consumedAt: now } },
    { returnDocument: 'after' },
  )
    .lean()
    .exec();

  return consumed ? { ok: true, userId: candidate.userId } : { ok: false, reason: 'already_consumed' };
}
