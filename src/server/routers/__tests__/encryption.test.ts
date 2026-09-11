import { eq } from 'drizzle-orm';

const USER = 'user-alice';

// The procedures under test are `protectedProcedure`s; authentication itself is
// covered by `lib/__tests__/routeAuth*`. Stubbing it here keeps these about what
// the router puts on the wire.
jest.mock('@/lib/routeAuth', () => {
  const actual = jest.requireActual('@/lib/routeAuth');
  return { ...actual, authenticateRequest: async () => ({ userId: 'user-alice', sid: 'sid-1', provider: 'siwe' }) };
});

import type { Db } from '@/db/client';
import { encryptionProfiles, encryptionStates } from '@/db/schema';
import { encryptionRouter } from '@/server/routers/encryption';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

/**
 * What the encryption router puts on the wire.
 *
 * These exist because of a real regression: `getProfileByUserId` returned the
 * account's generation and the router quietly dropped it, so every Authenticator
 * that compared its enrollment generation against the response found `undefined`
 * and wiped itself. Unit tests for the client passed — they mocked the
 * response — and only the end-to-end suite caught it. Asserting the contract
 * here is the cheap version of that check.
 */

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(() => resetTestDb(db));

/**
 * A caller whose request carries the generation header, because that is where
 * the middleware reads it from — not from procedure input.
 */
const caller = async (generation: number | null) => {
  const headers = new Headers();
  if (generation !== null) headers.set('x-signote-encryption-generation', String(generation));
  const req = new Request('http://localhost/api/trpc/encryption.profile', { headers });
  return encryptionRouter.createCaller({ req } as never);
};

async function seedProfile(generation = 0) {
  await db.insert(encryptionProfiles).values({
    userId: USER,
    version: 1,
    serverShare: 'c2VydmVyU2hhcmU=',
    salt: 'c2FsdA==',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
    keyCheck: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y3Q=' },
  });
  await db
    .insert(encryptionStates)
    .values({ userId: USER, generation, sessionEpoch: 0, survivingSid: null, rotationSessionSid: null })
    .onConflictDoUpdate({ target: encryptionStates.userId, set: { generation } });
}

describe('encryption.profile', () => {
  it('carries the account generation, not only the profile id', async () => {
    await seedProfile(0);

    const profile = await (await caller(0)).profile();

    expect(profile).toMatchObject({ exists: true, generation: 0 });
    expect(typeof (profile as { profileId: string }).profileId).toBe('string');
  });

  it('reports the advanced generation after a rotation, with the id unchanged', async () => {
    await seedProfile(0);
    const before = await (await caller(0)).profile();
    await db.update(encryptionStates).set({ generation: 3 }).where(eq(encryptionStates.userId, USER));

    const after = await (await caller(3)).profile();

    expect(after).toMatchObject({ exists: true, generation: 3 });
    // Stable on purpose: a rotation re-keys the account, it does not reset it.
    expect((after as { profileId: string }).profileId).toBe((before as { profileId: string }).profileId);
  });

  it('says so plainly when there is no profile', async () => {
    await expect((await caller(0)).profile()).resolves.toEqual({ exists: false });
  });
});

describe('encryption.material', () => {
  it('carries the generation alongside the server share', async () => {
    await seedProfile(2);

    await expect((await caller(2)).material()).resolves.toMatchObject({ serverShare: 'c2VydmVyU2hhcmU=' });
  });
});

describe('encryption.generation', () => {
  it('answers without a generation header, which is what makes it the bootstrap', async () => {
    await seedProfile(4);

    // Every other read refuses a request whose header disagrees with the
    // account. This one has to answer a caller that does not know the number
    // yet, or a device with no marker could never learn it.
    await expect((await caller(null)).generation()).resolves.toMatchObject({
      generation: 4,
      rotationInProgress: false,
    });
  });

  it('reports an operation in flight', async () => {
    await seedProfile(0);
    await db
      .update(encryptionStates)
      .set({ activeRotationId: '00000000-0000-7000-8000-000000000001' })
      .where(eq(encryptionStates.userId, USER));

    await expect((await caller(null)).generation()).resolves.toMatchObject({ rotationInProgress: true });
  });
});

describe('the rotation enablement switch', () => {
  const original = process.env.ROTATION_DISABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.ROTATION_DISABLED;
    else process.env.ROTATION_DISABLED = original;
  });

  it('offers rotation by default', async () => {
    await seedProfile(0);

    await expect((await caller(null)).generation()).resolves.toMatchObject({ rotationAvailable: true });
  });

  it('withdraws the entry point when ROTATION_DISABLED is set, without hiding an operation in flight', async () => {
    await seedProfile(0);
    await db
      .update(encryptionStates)
      .set({ activeRotationId: '00000000-0000-7000-8000-000000000001' })
      .where(eq(encryptionStates.userId, USER));
    process.env.ROTATION_DISABLED = '1';

    // Turning the feature off must never strand an account mid-rotation: the
    // client offers resume/cancel on `rotationInProgress` alone.
    await expect((await caller(null)).generation()).resolves.toMatchObject({
      rotationAvailable: false,
      rotationInProgress: true,
    });
  });
});
