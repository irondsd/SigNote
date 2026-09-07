import { count, eq } from 'drizzle-orm';

import { getDb, type Db } from '@/db/client';
import { authIdentities, passkeyCredentials, users } from '@/db/schema';

/**
 * One definition of "a way back in" for every detach/remove guard.
 * Email is a sign-in method in its own right, whether or not Google originally
 * proved it; identities and passkeys each count once per stored credential.
 */
export async function countSignInMethods(userId: string, db: Db = getDb()): Promise<number> {
  // Keep these sequential: callers may pass a transaction, whose queries all
  // share one connection and should not be fanned out with Promise.all.
  const identityRows = await db.select({ n: count() }).from(authIdentities).where(eq(authIdentities.userId, userId));
  const passkeyRows = await db
    .select({ n: count() })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, userId));
  const emailRows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

  return Number(identityRows[0].n) + Number(passkeyRows[0].n) + (emailRows[0]?.email ? 1 : 0);
}

/**
 * Serializes every mutation that can remove a sign-in method. Locking the
 * stable parent row makes passkey, identity, and email removals share one
 * mutex, so two individually-safe requests cannot jointly lock out the user.
 */
export async function lockSignInMethods(userId: string, db: Db): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  return rows.length > 0;
}
