import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { notificationPreferences, users } from '@/db/schema';

export type NotificationPreferences = {
  productNews: boolean;
  signInAlerts: boolean;
};

export type NotificationSettings = NotificationPreferences & {
  /** Where mail would go, or null when we have no address for this account. */
  email: string | null;
};

/** No row means no opt-out has been recorded, which means everything is on. */
const DEFAULTS: NotificationPreferences = { productNews: true, signInAlerts: true };

/**
 * The address transactional mail goes to.
 *
 * `users.email` is the authoritative one and is only ever set on proof of
 * control, so there is nothing to weigh up here — a row either has an address
 * or the account has none. Identities keep their own `email` column, but it is
 * whatever the provider reported, verified or not, and must not be mailed.
 */
export const getDeliverableEmail = async (userId: string): Promise<string | null> => {
  const rows = await getDb().select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.email ?? null;
};

export const getNotificationPreferences = async (userId: string): Promise<NotificationPreferences> => {
  const rows = await getDb()
    .select({ productNews: notificationPreferences.productNews, signInAlerts: notificationPreferences.signInAlerts })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  return rows[0] ?? DEFAULTS;
};

export const getNotificationSettings = async (userId: string): Promise<NotificationSettings> => {
  const [email, preferences] = await Promise.all([getDeliverableEmail(userId), getNotificationPreferences(userId)]);
  return { email, ...preferences };
};

/**
 * Upserts a partial change. The insert has to spell out the full row because
 * the defaults are "on" and a first-time opt-out must not silently re-enable
 * the other switch.
 */
export const setNotificationPreferences = async (
  userId: string,
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> => {
  const current = await getNotificationPreferences(userId);
  const next = { ...current, ...patch };

  await getDb()
    .insert(notificationPreferences)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: next });

  return next;
};

export const eraseNotificationPreferences = (userId: string) =>
  getDb().delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
