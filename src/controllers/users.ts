import { and, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authIdentities, users } from '@/db/schema';
import { claimEmailForUser, findUserIdByEmail, normalizeEmail } from './userEmail';

export type UserRow = {
  _id: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

type RawUser = typeof users.$inferSelect;

/** `created` is what tells the caller to send a welcome email. */
export type UpsertResult = { user: UserRow; created: boolean } | null;

const mapUser = ({ id, ...rest }: RawUser): UserRow => ({ _id: id, ...rest });

const findUserById = async (userId: string): Promise<UserRow | null> => {
  const rows = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ? mapUser(rows[0]) : null;
};

/**
 * Refused rather than signed in: an unverified address that already belongs to
 * an account is exactly the case the whole verified-only rule exists for.
 * Creating a second, address-less account here would look to the user like
 * they had signed into an empty copy of their own vault.
 */
export type GoogleUpsertResult = UpsertResult | { user: null; created: false; error: 'EMAIL_TAKEN_UNVERIFIED' };

export const upsertGoogleUser = async (
  googleId: string,
  displayName: string,
  email?: string,
  image?: string,
  emailVerified?: boolean,
): Promise<GoogleUpsertResult> => {
  const db = getDb();
  const now = new Date();

  const existing = await db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'google'), eq(authIdentities.providerSubject, googleId)))
    .limit(1);

  if (existing[0]) {
    // Google's own copy is refreshed every time: the address and its verified
    // flag can both change, and this row is the audit trail of what the
    // provider actually told us.
    await db
      .update(authIdentities)
      .set({ lastLoginAt: now, updatedAt: now, email, emailVerified })
      .where(eq(authIdentities.id, existing[0].id));

    const user = await findUserById(existing[0].userId);
    if (!user) return null;

    // Re-run on every sign-in, not just the first: an account created without
    // an address because Google hadn't verified it picks one up here as soon
    // as Google does.
    await claimIfVerified(user._id, existing[0].id, email, emailVerified);
    return { user, created: false };
  }

  // An unknown subject whose address is already spoken for. Whether this
  // attaches to that account or is refused turns entirely on the verified flag:
  // both sides proving control of one mailbox is a link, one side asserting it
  // without proof is not.
  const holderId = email ? await findUserIdByEmail(email) : null;
  if (holderId) {
    if (emailVerified !== true) return { user: null, created: false, error: 'EMAIL_TAKEN_UNVERIFIED' };

    const user = await findUserById(holderId);
    if (!user) return null;

    await db.insert(authIdentities).values({
      userId: holderId,
      provider: 'google',
      providerSubject: googleId,
      lastLoginAt: now,
      email,
      emailVerified,
      rawProfileJson: { displayName, image },
    });

    return { user, created: false };
  }

  const result = await db.transaction(async (tx) => {
    const inserted = await tx.insert(users).values({ displayName }).returning();
    const user = inserted[0];
    const identity = await tx
      .insert(authIdentities)
      .values({
        userId: user.id,
        provider: 'google',
        providerSubject: googleId,
        lastLoginAt: now,
        email,
        emailVerified,
        rawProfileJson: { displayName, image },
      })
      .returning({ id: authIdentities.id });
    return { user: mapUser(user), identityId: identity[0].id };
  });

  // Outside the transaction: an unverified address simply isn't claimed, which
  // leaves a signed-in account with no email rather than failing the sign-in.
  await claimIfVerified(result.user._id, result.identityId, email, emailVerified);
  return { user: result.user, created: true };
};

/** A provider may only attach an address it says it has verified. */
const claimIfVerified = async (
  userId: string,
  identityId: string,
  email: string | undefined,
  emailVerified: boolean | undefined,
) => {
  if (!email || emailVerified !== true) return;
  await claimEmailForUser({ userId, email, ownerIdentityId: identityId });
};

/**
 * Resolves the account behind a proven email address, creating one if the
 * address is new.
 *
 * The caller must already have consumed a one-time code for this address —
 * that consumption *is* the proof, which is why the address is claimed
 * unconditionally here with no owning identity: nothing owns an address a
 * mailbox proved, so the user stays free to detach it.
 */
export const upsertEmailUser = async (rawEmail: string): Promise<UpsertResult> => {
  const email = normalizeEmail(rawEmail);

  const existingUserId = await findUserIdByEmail(email);
  if (existingUserId) {
    const user = await findUserById(existingUserId);
    return user ? { user, created: false } : null;
  }

  const inserted = await getDb()
    .insert(users)
    .values({ displayName: email, email, emailVerifiedAt: new Date() })
    .returning();

  return { user: mapUser(inserted[0]), created: true };
};

export const updateDisplayName = async (userId: string, displayName: string): Promise<UserRow | null> => {
  const rows = await getDb()
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return rows[0] ? mapUser(rows[0]) : null;
};

export const upsertSiweUser = async (address: string): Promise<UpsertResult> => {
  const db = getDb();
  const now = new Date();
  const addressLower = address.toLowerCase();

  const existing = await db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'siwe'), eq(authIdentities.providerSubject, addressLower)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(authIdentities)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(authIdentities.id, existing[0].id));
    const user = await findUserById(existing[0].userId);
    return user ? { user, created: false } : null;
  }

  return db.transaction(async (tx) => {
    const inserted = await tx.insert(users).values({ displayName: address }).returning();
    const user = inserted[0];
    await tx.insert(authIdentities).values({
      userId: user.id,
      provider: 'siwe',
      providerSubject: addressLower,
      lastLoginAt: now,
      rawProfileJson: { addressLower, addressChecksum: address },
    });
    return { user: mapUser(user), created: true };
  });
};
