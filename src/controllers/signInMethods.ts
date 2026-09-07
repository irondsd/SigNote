import { count, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authIdentities, passkeyCredentials, users } from '@/db/schema';

/**
 * One definition of "a way back in" for every detach/remove guard.
 * Email is a sign-in method in its own right, whether or not Google originally
 * proved it; identities and passkeys each count once per stored credential.
 */
export async function countSignInMethods(userId: string): Promise<number> {
  const db = getDb();
  const [identityRows, passkeyRows, emailRows] = await Promise.all([
    db.select({ n: count() }).from(authIdentities).where(eq(authIdentities.userId, userId)),
    db.select({ n: count() }).from(passkeyCredentials).where(eq(passkeyCredentials.userId, userId)),
    db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1),
  ]);

  return Number(identityRows[0].n) + Number(passkeyRows[0].n) + (emailRows[0]?.email ? 1 : 0);
}
