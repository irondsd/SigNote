import { and, count, desc, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { passkeyCredentials, users, type PasskeyDeviceType } from '@/db/schema';
import { LastIdentityError } from './identities';
import { countSignInMethods } from './signInMethods';

export type PasskeyInsert = {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  aaguid: string;
  deviceType: PasskeyDeviceType;
  backedUp: boolean;
  nickname: string;
};

export type PasskeyRow = typeof passkeyCredentials.$inferSelect;

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  return getDb()
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, userId))
    .orderBy(desc(passkeyCredentials.createdAt));
}

export async function countPasskeys(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ n: count() })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, userId));
  return Number(rows[0].n);
}

export async function getPasskeyUserLabel(userId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.displayName ?? null;
}

export async function insertPasskey(input: PasskeyInsert): Promise<PasskeyRow> {
  const rows = await getDb().insert(passkeyCredentials).values(input).returning();
  return rows[0];
}

export async function findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | null> {
  const rows = await getDb()
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, credentialId))
    .limit(1);
  return rows[0] ?? null;
}

export async function recordPasskeyUse(id: string, counter: number): Promise<boolean> {
  const rows = await getDb()
    .update(passkeyCredentials)
    .set({ counter, lastUsedAt: new Date() })
    .where(eq(passkeyCredentials.id, id))
    .returning({ id: passkeyCredentials.id });
  return rows.length > 0;
}

export async function renamePasskey(userId: string, id: string, nickname: string): Promise<boolean> {
  const rows = await getDb()
    .update(passkeyCredentials)
    .set({ nickname })
    .where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, userId)))
    .returning({ id: passkeyCredentials.id });
  return rows.length > 0;
}

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  const existing = await getDb()
    .select({ id: passkeyCredentials.id })
    .from(passkeyCredentials)
    .where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, userId)))
    .limit(1);
  if (!existing[0]) return false;
  if ((await countSignInMethods(userId)) <= 1) throw new LastIdentityError();

  const rows = await getDb()
    .delete(passkeyCredentials)
    .where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, userId)))
    .returning({ id: passkeyCredentials.id });
  return rows.length > 0;
}

/** Creates a passkey-only account after the provisional registration verifies. */
export async function createPasskeyUser(input: Omit<PasskeyInsert, 'userId'> & { userId: string }) {
  return getDb().transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (existing[0]) return null;

    const userRows = await tx.insert(users).values({ id: input.userId, displayName: 'Passkey user' }).returning();
    const credentialRows = await tx.insert(passkeyCredentials).values(input).returning();
    return { user: userRows[0], credential: credentialRows[0], created: true as const };
  });
}
