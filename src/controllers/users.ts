import { and, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authIdentities, users } from '@/db/schema';

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

export const upsertGoogleUser = async (
  googleId: string,
  displayName: string,
  email?: string,
  image?: string,
): Promise<UpsertResult> => {
  const db = getDb();
  const now = new Date();

  const existing = await db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'google'), eq(authIdentities.providerSubject, googleId)))
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
    const inserted = await tx.insert(users).values({ displayName }).returning();
    const user = inserted[0];
    await tx.insert(authIdentities).values({
      userId: user.id,
      provider: 'google',
      providerSubject: googleId,
      lastLoginAt: now,
      email,
      rawProfileJson: { displayName, image },
    });
    return { user: mapUser(user), created: true };
  });
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
