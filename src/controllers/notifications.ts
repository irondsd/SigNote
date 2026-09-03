import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authIdentities, notificationPreferences } from '@/db/schema';

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
 * The address transactional mail would be sent to.
 *
 * Today that only comes from a linked Google identity — a wallet-only account
 * has none, and the UI disables the settings entry for it. When email sign-in
 * lands it will supply an address the same way, and this is the one place that
 * has to learn about it. A verified address wins over an unverified one.
 */
export const getDeliverableEmail = async (userId: string): Promise<string | null> => {
  const rows = await getDb()
    .select({ email: authIdentities.email, verified: authIdentities.emailVerified })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId));

  const withEmail = rows.filter((row): row is { email: string; verified: boolean | null } => Boolean(row.email));
  return withEmail.find((row) => row.verified)?.email ?? withEmail[0]?.email ?? null;
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
