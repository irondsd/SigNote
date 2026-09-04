import { eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { users } from '@/db/schema';

/**
 * Ownership rules for `users.email`.
 *
 * One rule governs all of this: **an address attaches to a user only on proof
 * of control.** An emailed one-time code is proof by definition; an OIDC
 * provider is proof only when it asserts the address is verified. Everything
 * below is that sentence, spelled out.
 */

/** Lowercase and trim. See the schema comment for why nothing more. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

const byEmail = (email: string) => sql`lower(${users.email}) = ${normalizeEmail(email)}`;

export const findUserIdByEmail = async (email: string): Promise<string | null> => {
  const rows = await getDb().select({ id: users.id }).from(users).where(byEmail(email)).limit(1);
  return rows[0]?.id ?? null;
};

export type ClaimOutcome =
  /** Attached. */
  | 'claimed'
  /** The user already has an address; we never move one on a provider's say-so. */
  | 'user-has-email'
  /** Another account already holds it. Not an error here — the caller is already signed in. */
  | 'taken-by-other-user';

/**
 * Attaches an address to a user, if it is free to attach.
 *
 * Runs on *every* Google sign-in, not just the first, which is what makes an
 * account created without an address (because the provider hadn't verified it)
 * heal by itself the next time the user signs in after the provider does.
 *
 * `ownerIdentityId` is the identity that proved it, or null when a one-time
 * code did — null being what later allows the user to detach it.
 */
export const claimEmailForUser = async (params: {
  userId: string;
  email: string;
  ownerIdentityId: string | null;
}): Promise<ClaimOutcome> => {
  const email = normalizeEmail(params.email);
  const db = getDb();

  const holder = await db.select({ id: users.id }).from(users).where(byEmail(email)).limit(1);
  if (holder[0] && holder[0].id !== params.userId) return 'taken-by-other-user';

  const [self] = await db.select({ email: users.email }).from(users).where(eq(users.id, params.userId)).limit(1);
  if (self?.email) return self.email === email ? 'claimed' : 'user-has-email';

  await db
    .update(users)
    .set({ email, emailVerifiedAt: new Date(), emailOwnerIdentityId: params.ownerIdentityId })
    .where(eq(users.id, params.userId));

  return 'claimed';
};

/**
 * Called when an identity is unlinked: the address it proved stays — the proof
 * genuinely happened, and taking away a sign-in method as a side effect of
 * removing a different one is how people get locked out. It simply becomes
 * unowned, and therefore detachable by hand.
 */
export const releaseEmailOwnership = async (identityIds: string[]): Promise<void> => {
  if (identityIds.length === 0) return;
  await getDb()
    .update(users)
    .set({ emailOwnerIdentityId: null })
    .where(inArray(users.emailOwnerIdentityId, identityIds));
};

export type UserEmail = {
  email: string | null;
  verifiedAt: Date | null;
  /** False while an identity owns it — the UI shows it read-only, "via Google". */
  removable: boolean;
};

export const getUserEmail = async (userId: string): Promise<UserEmail> => {
  const rows = await getDb()
    .select({
      email: users.email,
      verifiedAt: users.emailVerifiedAt,
      owner: users.emailOwnerIdentityId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  return {
    email: row?.email ?? null,
    verifiedAt: row?.verifiedAt ?? null,
    removable: Boolean(row?.email) && !row?.owner,
  };
};
