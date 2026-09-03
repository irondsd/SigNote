import { and, eq } from 'drizzle-orm';
import type { Address } from 'viem';

import { authIdentities, users } from '../../src/db/schema';
import { testDb } from './db';

/**
 * Returns the user id for the given SIWE address, creating the user +
 * identity if they don't exist yet. Fixtures call this before inserting
 * note/secret/seal/encryptionProfile rows.
 */
export const getOrCreateUserId = async (address: Address): Promise<string> => {
  const db = testDb();
  const now = new Date();
  const addressLower = address.toLowerCase();

  const existing = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'siwe'), eq(authIdentities.providerSubject, addressLower)))
    .limit(1);

  if (existing[0]) return existing[0].userId;

  const [user] = await db.insert(users).values({ displayName: address, createdAt: now }).returning({ id: users.id });

  await db.insert(authIdentities).values({
    userId: user.id,
    provider: 'siwe',
    providerSubject: addressLower,
    lastLoginAt: now,
    rawProfileJson: { addressLower, addressChecksum: address },
  });

  return user.id;
};
