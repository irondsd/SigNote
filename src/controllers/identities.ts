import { and, count, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  authIdentities,
  encryptionProfiles,
  notes,
  sealNotes,
  secretNotes,
  users,
  type AuthProvider,
} from '@/db/schema';

export class ConflictEncryptedDataError extends Error {
  constructor() {
    super('CONFLICT_ENCRYPTED_DATA');
    this.name = 'ConflictEncryptedDataError';
  }
}

export class AlreadyLinkedError extends Error {
  constructor() {
    super('ALREADY_LINKED');
    this.name = 'AlreadyLinkedError';
  }
}

export class LastIdentityError extends Error {
  constructor() {
    super('LAST_IDENTITY');
    this.name = 'LastIdentityError';
  }
}

export type IdentityRow = {
  _id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email?: string;
  emailVerified?: boolean;
  lastLoginAt: Date;
  rawProfileJson?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type RawIdentity = typeof authIdentities.$inferSelect;

// null columns map back to absent-optional fields, matching the old lean-doc
// JSON where unset paths were simply missing.
const mapIdentity = (row: RawIdentity): IdentityRow => ({
  _id: row.id,
  userId: row.userId,
  provider: row.provider,
  providerSubject: row.providerSubject,
  email: row.email ?? undefined,
  emailVerified: row.emailVerified ?? undefined,
  lastLoginAt: row.lastLoginAt,
  rawProfileJson: row.rawProfileJson ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const getUserIdentities = async (userId: string): Promise<IdentityRow[]> => {
  const rows = await getDb().select().from(authIdentities).where(eq(authIdentities.userId, userId));
  return rows.map(mapIdentity);
};

export const linkIdentity = async (
  primaryUserId: string,
  provider: AuthProvider,
  providerSubject: string,
  identityData: Record<string, unknown>,
) => {
  const db = getDb();

  const existingRows = await db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, provider), eq(authIdentities.providerSubject, providerSubject)))
    .limit(1);
  const existing = existingRows[0];

  if (existing) {
    if (existing.userId === primaryUserId) {
      // Already linked to this user — no-op
      return;
    }

    // Belongs to a different user — check for encrypted data
    const secondaryUserId = existing.userId;
    const [secretsCount, sealsCount] = await Promise.all([
      db
        .select({ n: count() })
        .from(secretNotes)
        .where(and(eq(secretNotes.userId, secondaryUserId), isNull(secretNotes.deletedAt))),
      db
        .select({ n: count() })
        .from(sealNotes)
        .where(and(eq(sealNotes.userId, secondaryUserId), isNull(sealNotes.deletedAt))),
    ]);

    if (Number(secretsCount[0].n) > 0 || Number(sealsCount[0].n) > 0) {
      throw new ConflictEncryptedDataError();
    }

    await db.transaction(async (tx) => {
      // Migrate notes
      await tx.update(notes).set({ userId: primaryUserId }).where(eq(notes.userId, secondaryUserId));

      // Remove secondary encryption profile (if any, but no secrets/seals)
      await tx.delete(encryptionProfiles).where(eq(encryptionProfiles.userId, secondaryUserId));

      // Move all identities of secondary to primary
      await tx.update(authIdentities).set({ userId: primaryUserId }).where(eq(authIdentities.userId, secondaryUserId));

      // Delete secondary user record
      await tx.delete(users).where(eq(users.id, secondaryUserId));
    });

    return;
  }

  await db.insert(authIdentities).values({
    userId: primaryUserId,
    provider,
    providerSubject,
    lastLoginAt: new Date(),
    email: typeof identityData.email === 'string' ? identityData.email : undefined,
    emailVerified: typeof identityData.emailVerified === 'boolean' ? identityData.emailVerified : undefined,
    rawProfileJson:
      identityData.rawProfileJson && typeof identityData.rawProfileJson === 'object'
        ? (identityData.rawProfileJson as Record<string, unknown>)
        : undefined,
  });
};

export const unlinkIdentity = async (userId: string, provider: string): Promise<boolean> => {
  const db = getDb();

  const total = await db.select({ n: count() }).from(authIdentities).where(eq(authIdentities.userId, userId));
  if (Number(total[0].n) <= 1) {
    throw new LastIdentityError();
  }

  const deleted = await db
    .delete(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, provider as AuthProvider)))
    .returning({ id: authIdentities.id });
  return deleted.length > 0;
};
