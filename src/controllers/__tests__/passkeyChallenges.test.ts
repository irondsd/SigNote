import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { passkeyChallenges } from '@/db/schema';
import { checkChallengeRateLimit, consumeChallenge, createChallenge } from '@/controllers/passkeyChallenges';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(teardownTestDb);
beforeEach(async () => resetTestDb(db));

describe('passkey challenges', () => {
  it('can be consumed exactly once', async () => {
    await createChallenge({ challenge: 'challenge-1', kind: 'authenticate', userId: null, ip: '127.0.0.1' });

    expect(await consumeChallenge({ challenge: 'challenge-1', kind: 'authenticate', userId: null })).toMatchObject({
      challenge: 'challenge-1',
    });
    expect(await consumeChallenge({ challenge: 'challenge-1', kind: 'authenticate', userId: null })).toBeNull();
  });

  it('binds the kind and user without burning a mismatch', async () => {
    await createChallenge({ challenge: 'challenge-2', kind: 'register', userId: 'user-a', ip: '' });

    expect(await consumeChallenge({ challenge: 'challenge-2', kind: 'authenticate', userId: null })).toBeNull();
    expect(await consumeChallenge({ challenge: 'challenge-2', kind: 'register', userId: 'user-b' })).toBeNull();
    expect(await consumeChallenge({ challenge: 'challenge-2', kind: 'register', userId: 'user-a' })).not.toBeNull();
  });

  it('rejects expired challenges', async () => {
    await createChallenge({ challenge: 'expired', kind: 'register', userId: 'user-a', ip: '' });
    await db
      .update(passkeyChallenges)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(passkeyChallenges.challenge, 'expired'));

    expect(await consumeChallenge({ challenge: 'expired', kind: 'register', userId: 'user-a' })).toBeNull();
  });

  it('rate-limits repeated ceremonies by IP', async () => {
    for (let index = 0; index < 10; index += 1) {
      await createChallenge({ challenge: `rate-${index}`, kind: 'authenticate', userId: null, ip: '10.0.0.1' });
    }

    expect(await checkChallengeRateLimit('10.0.0.1')).toBe(false);
    expect(await checkChallengeRateLimit('10.0.0.2')).toBe(true);
    expect(await checkChallengeRateLimit('')).toBe(true);
  });
});
