import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { authIdentities, users } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import { claimEmailForUser, getUserEmail, releaseEmailOwnership } from '@/controllers/userEmail';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

const userId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439012';

const addUser = (id: string, email: string | null = null) =>
  db.insert(users).values({ id, displayName: 'Test', email });

const addIdentity = async (owner: string) => {
  const rows = await db
    .insert(authIdentities)
    .values({
      userId: owner,
      provider: 'google',
      providerSubject: `sub-${Math.random()}`,
      lastLoginAt: new Date(),
    })
    .returning({ id: authIdentities.id });
  return rows[0].id;
};

const emailOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

describe('userEmail controller', () => {
  describe('claimEmailForUser', () => {
    it('attaches a free address and records the identity that proved it', async () => {
      await addUser(userId);
      const identityId = await addIdentity(userId);

      expect(await claimEmailForUser({ userId, email: 'a@example.com', ownerIdentityId: identityId })).toBe('claimed');

      const row = await emailOf(userId);
      expect(row.email).toBe('a@example.com');
      expect(row.emailVerifiedAt).not.toBeNull();
      expect(row.emailOwnerIdentityId).toBe(identityId);
    });

    it('normalises case, so the same address cannot be claimed twice in two spellings', async () => {
      await addUser(userId);
      await claimEmailForUser({ userId, email: '  A@Example.COM ', ownerIdentityId: null });
      expect((await emailOf(userId)).email).toBe('a@example.com');

      await addUser(otherUserId);
      expect(await claimEmailForUser({ userId: otherUserId, email: 'a@example.com', ownerIdentityId: null })).toBe(
        'taken-by-other-user',
      );
    });

    it('refuses an address another account already holds', async () => {
      await addUser(userId);
      await addUser(otherUserId, 'taken@example.com');

      expect(await claimEmailForUser({ userId, email: 'taken@example.com', ownerIdentityId: null })).toBe(
        'taken-by-other-user',
      );
      expect((await emailOf(userId)).email).toBeNull();
    });

    it('never moves an address the user already has', async () => {
      await addUser(userId, 'first@example.com');

      expect(await claimEmailForUser({ userId, email: 'second@example.com', ownerIdentityId: null })).toBe(
        'user-has-email',
      );
      expect((await emailOf(userId)).email).toBe('first@example.com');
    });

    it('is idempotent when re-claiming the address already held', async () => {
      await addUser(userId, 'a@example.com');

      expect(await claimEmailForUser({ userId, email: 'a@example.com', ownerIdentityId: null })).toBe('claimed');
    });

    it('claims on a later call, which is how an unverified account heals', async () => {
      await addUser(userId);
      const identityId = await addIdentity(userId);

      // First sign-in: provider had not verified, so nothing was claimed.
      expect((await emailOf(userId)).email).toBeNull();

      // Next sign-in, now verified.
      expect(await claimEmailForUser({ userId, email: 'a@example.com', ownerIdentityId: identityId })).toBe('claimed');
      expect((await emailOf(userId)).email).toBe('a@example.com');
    });
  });

  it('allows any number of accounts with no address at all', async () => {
    // The unique index is on lower(email), and Postgres treats NULLs as
    // distinct — which is the only reason wallet-only accounts can coexist.
    await addUser(userId);
    await addUser(otherUserId);
    await addUser('507f1f77bcf86cd799439013');

    expect((await db.select().from(users)).length).toBe(3);
  });

  describe('releaseEmailOwnership', () => {
    it('keeps the address but makes it removable', async () => {
      await addUser(userId);
      const identityId = await addIdentity(userId);
      await claimEmailForUser({ userId, email: 'a@example.com', ownerIdentityId: identityId });

      expect(await getUserEmail(userId)).toMatchObject({ email: 'a@example.com', removable: false });

      await releaseEmailOwnership([identityId]);

      expect(await getUserEmail(userId)).toMatchObject({ email: 'a@example.com', removable: true });
    });

    it('leaves an address owned by a different identity alone', async () => {
      await addUser(userId);
      const owner = await addIdentity(userId);
      const unrelated = await addIdentity(userId);
      await claimEmailForUser({ userId, email: 'a@example.com', ownerIdentityId: owner });

      await releaseEmailOwnership([unrelated]);

      expect(await getUserEmail(userId)).toMatchObject({ removable: false });
    });

    it('does nothing when given no ids', async () => {
      await expect(releaseEmailOwnership([])).resolves.toBeUndefined();
    });
  });

  describe('getUserEmail', () => {
    it('reports a wallet-only account as having nothing to remove', async () => {
      await addUser(userId);

      expect(await getUserEmail(userId)).toEqual({ email: null, verifiedAt: null, removable: false });
    });

    it('marks an address proved by a code as removable', async () => {
      await addUser(userId);
      await claimEmailForUser({ userId, email: 'a@example.com', ownerIdentityId: null });

      expect(await getUserEmail(userId)).toMatchObject({ removable: true });
    });
  });
});
