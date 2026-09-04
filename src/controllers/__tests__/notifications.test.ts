import type { Db } from '@/db/client';
import { authIdentities, notificationPreferences, users } from '@/db/schema';
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

const addUser = (id: string, email: string | null = null) =>
  db.insert(users).values({ id, displayName: 'Test', email });

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
      await addUser(userId);
      await addIdentity({ provider: 'siwe', email: null });

      expect(await getDeliverableEmail(userId)).toBeNull();
    });

    it('is null when the user does not exist', async () => {
      expect(await getDeliverableEmail(userId)).toBeNull();
    });

    it('returns the address held on the user', async () => {
      await addUser(userId, 'a@example.com');

      expect(await getDeliverableEmail(userId)).toBe('a@example.com');
    });

    it("never mails an identity's own address, which the provider may not have verified", async () => {
      await addUser(userId);
      await addIdentity({ email: 'unverified@example.com', emailVerified: false });

      expect(await getDeliverableEmail(userId)).toBeNull();
    });

    it("ignores another user's address", async () => {
      await addUser(userId);
      await addUser(otherUserId, 'other@example.com');

      expect(await getDeliverableEmail(userId)).toBeNull();
    });
  });

  describe('getNotificationSettings', () => {
    it('combines the address with the preferences', async () => {
      await addUser(userId, 'a@example.com');
      await setNotificationPreferences(userId, { signInAlerts: false });

      expect(await getNotificationSettings(userId)).toEqual({
        email: 'a@example.com',
        productNews: true,
        signInAlerts: false,
      });
    });
  });
});
