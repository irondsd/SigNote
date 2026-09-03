import type { Db } from '@/db/client';
import { authIdentities, notificationPreferences } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import {
  getDeliverableEmail,
  getNotificationPreferences,
  getNotificationSettings,
  setNotificationPreferences,
} from '@/controllers/notifications';

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

const addIdentity = (overrides: Partial<typeof authIdentities.$inferInsert> = {}) =>
  db.insert(authIdentities).values({
    userId,
    provider: 'google',
    providerSubject: `sub-${Math.random()}`,
    lastLoginAt: new Date(),
    ...overrides,
  });

const countRows = async () => (await db.select().from(notificationPreferences)).length;

describe('notifications controller', () => {
  describe('getNotificationPreferences', () => {
    it('defaults to everything on when no row exists', async () => {
      expect(await getNotificationPreferences(userId)).toEqual({ productNews: true, signInAlerts: true });
    });

    it('does not create a row just by reading', async () => {
      await getNotificationPreferences(userId);
      expect(await countRows()).toBe(0);
    });
  });

  describe('setNotificationPreferences', () => {
    it('creates a row on first opt-out and leaves the other switch on', async () => {
      const next = await setNotificationPreferences(userId, { productNews: false });

      expect(next).toEqual({ productNews: false, signInAlerts: true });
      expect(await getNotificationPreferences(userId)).toEqual({ productNews: false, signInAlerts: true });
      expect(await countRows()).toBe(1);
    });

    it('updates in place rather than inserting a second row', async () => {
      await setNotificationPreferences(userId, { productNews: false });
      await setNotificationPreferences(userId, { signInAlerts: false });

      expect(await getNotificationPreferences(userId)).toEqual({ productNews: false, signInAlerts: false });
      expect(await countRows()).toBe(1);
    });

    it('turns a preference back on', async () => {
      await setNotificationPreferences(userId, { productNews: false });
      await setNotificationPreferences(userId, { productNews: true });

      expect(await getNotificationPreferences(userId)).toEqual({ productNews: true, signInAlerts: true });
    });

    it('leaves another user untouched', async () => {
      await setNotificationPreferences(userId, { productNews: false, signInAlerts: false });

      expect(await getNotificationPreferences(otherUserId)).toEqual({ productNews: true, signInAlerts: true });
    });
  });

  describe('getDeliverableEmail', () => {
    it('is null for a wallet-only account', async () => {
      await addIdentity({ provider: 'siwe', email: null });

      expect(await getDeliverableEmail(userId)).toBeNull();
    });

    it('is null when the account has no identities at all', async () => {
      expect(await getDeliverableEmail(userId)).toBeNull();
    });

    it('returns the address from a linked Google identity', async () => {
      await addIdentity({ email: 'a@example.com', emailVerified: true });

      expect(await getDeliverableEmail(userId)).toBe('a@example.com');
    });

    it('prefers a verified address over an unverified one', async () => {
      await addIdentity({ provider: 'siwe', email: 'unverified@example.com', emailVerified: false });
      await addIdentity({ email: 'verified@example.com', emailVerified: true });

      expect(await getDeliverableEmail(userId)).toBe('verified@example.com');
    });

    it("ignores another user's address", async () => {
      await db.insert(authIdentities).values({
        userId: otherUserId,
        provider: 'google',
        providerSubject: 'other',
        email: 'other@example.com',
        lastLoginAt: new Date(),
      });

      expect(await getDeliverableEmail(userId)).toBeNull();
    });
  });

  describe('getNotificationSettings', () => {
    it('combines the address with the preferences', async () => {
      await addIdentity({ email: 'a@example.com', emailVerified: true });
      await setNotificationPreferences(userId, { signInAlerts: false });

      expect(await getNotificationSettings(userId)).toEqual({
        email: 'a@example.com',
        productNews: true,
        signInAlerts: false,
      });
    });
  });
});
