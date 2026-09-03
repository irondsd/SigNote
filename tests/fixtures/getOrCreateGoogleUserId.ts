import { and, eq } from 'drizzle-orm';

import { authIdentities, users } from '../../src/db/schema';
import { testDb } from './db';

/**
 * Returns the user id for the given Google ID, creating the user + identity
 * if they don't exist yet.
 */
export const getOrCreateGoogleUserId = async (googleId: string, email: string): Promise<string> => {
  const db = testDb();
  const now = new Date();

  const existing = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'google'), eq(authIdentities.providerSubject, googleId)))
    .limit(1);

  if (existing[0]) return existing[0].userId;

  const [user] = await db.insert(users).values({ displayName: email, createdAt: now }).returning({ id: users.id });

  await db.insert(authIdentities).values({
    userId: user.id,
    provider: 'google',
    providerSubject: googleId,
    email,
    emailVerified: true,
    lastLoginAt: now,
    rawProfileJson: { sub: googleId, email, name: email, email_verified: true },
  });

  return user.id;
};
