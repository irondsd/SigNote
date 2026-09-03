import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import type { Db } from '@/db/client';
import { desktopAuthAttempts } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import {
  DESKTOP_ATTEMPT_RATE_LIMIT_MAX,
  DESKTOP_EXCHANGE_ATTEMPT_MAX,
  authorizeDesktopAuthAttempt,
  canCreateDesktopAuthAttempt,
  consumeDesktopAuthAttempt,
  createDesktopAuthAttempt,
  hashDesktopAuthValue,
} from '../desktopAuth';

let db: Db;

const state = 's'.repeat(43);
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
const userId = uuidv7();

const findAttempt = async (attemptId: string) => {
  const rows = await db.select().from(desktopAuthAttempts).where(eq(desktopAuthAttempts.attemptId, attemptId)).limit(1);
  return rows[0];
};

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTestDb(db);
});

async function createAndAuthorize() {
  const attempt = await createDesktopAuthAttempt({ state, codeChallenge: challenge, ip: '127.0.0.1' });
  const authorization = await authorizeDesktopAuthAttempt({ attemptId: attempt.attemptId, state, userId });
  expect(authorization).not.toBeNull();
  return { ...attempt, authorizationCode: authorization!.authorizationCode };
}

describe('desktopAuth controller', () => {
  it('stores hashes instead of the state or authorization code', async () => {
    const attempt = await createAndAuthorize();
    const row = await findAttempt(attempt.attemptId);

    expect(row?.stateHash).toBe(hashDesktopAuthValue(state));
    expect(row?.stateHash).not.toContain(state);
    expect(row?.authorizationCodeHash).toBe(hashDesktopAuthValue(attempt.authorizationCode));
    expect(row?.authorizationCodeHash).not.toContain(attempt.authorizationCode);
    expect(row?.status).toBe('authorized');
  });

  it('requires the original state to authorize a pending attempt', async () => {
    const attempt = await createDesktopAuthAttempt({ state, codeChallenge: challenge, ip: '127.0.0.1' });

    const result = await authorizeDesktopAuthAttempt({
      attemptId: attempt.attemptId,
      state: 'x'.repeat(43),
      userId,
    });

    expect(result).toBeNull();
    expect((await findAttempt(attempt.attemptId))?.status).toBe('pending');
  });

  it('consumes a valid PKCE exchange exactly once', async () => {
    const attempt = await createAndAuthorize();
    const credentials = {
      attemptId: attempt.attemptId,
      state,
      authorizationCode: attempt.authorizationCode,
      codeVerifier: verifier,
    };

    await expect(consumeDesktopAuthAttempt(credentials)).resolves.toEqual({ ok: true, userId });
    await expect(consumeDesktopAuthAttempt(credentials)).resolves.toEqual({ ok: false, reason: 'already_consumed' });
  });

  it('allows only one of two concurrent exchanges to consume the code', async () => {
    const attempt = await createAndAuthorize();
    const credentials = {
      attemptId: attempt.attemptId,
      state,
      authorizationCode: attempt.authorizationCode,
      codeVerifier: verifier,
    };

    const results = await Promise.all([consumeDesktopAuthAttempt(credentials), consumeDesktopAuthAttempt(credentials)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === 'already_consumed')).toHaveLength(1);
  });

  it('rejects an incorrect verifier without consuming the attempt', async () => {
    const attempt = await createAndAuthorize();

    await expect(
      consumeDesktopAuthAttempt({
        attemptId: attempt.attemptId,
        state,
        authorizationCode: attempt.authorizationCode,
        codeVerifier: 'w'.repeat(43),
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_or_expired' });

    expect((await findAttempt(attempt.attemptId))?.status).toBe('authorized');
  });

  it('stops accepting guesses after the exchange-attempt limit', async () => {
    const attempt = await createAndAuthorize();
    const badCredentials = {
      attemptId: attempt.attemptId,
      state,
      authorizationCode: attempt.authorizationCode,
      codeVerifier: 'w'.repeat(43),
    };

    for (let index = 0; index < DESKTOP_EXCHANGE_ATTEMPT_MAX; index += 1) {
      await expect(consumeDesktopAuthAttempt(badCredentials)).resolves.toEqual({
        ok: false,
        reason: 'invalid_or_expired',
      });
    }
    await expect(consumeDesktopAuthAttempt(badCredentials)).resolves.toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('rejects expired attempts', async () => {
    const attempt = await createAndAuthorize();
    await db
      .update(desktopAuthAttempts)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(desktopAuthAttempts.attemptId, attempt.attemptId));

    await expect(
      consumeDesktopAuthAttempt({
        attemptId: attempt.attemptId,
        state,
        authorizationCode: attempt.authorizationCode,
        codeVerifier: verifier,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_or_expired' });
  });

  it('rate-limits attempt creation by IP address', async () => {
    const ip = '203.0.113.10';
    for (let index = 0; index < DESKTOP_ATTEMPT_RATE_LIMIT_MAX; index += 1) {
      await createDesktopAuthAttempt({ state: `${index}`.padEnd(43, 's'), codeChallenge: challenge, ip });
    }

    await expect(canCreateDesktopAuthAttempt(ip)).resolves.toBe(false);
    await expect(canCreateDesktopAuthAttempt('203.0.113.11')).resolves.toBe(true);
  });
});
