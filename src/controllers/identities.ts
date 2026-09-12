import { and, count, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  currentRequestGeneration,
  VaultConflictError,
  withAccountLock,
  withVaultRead,
  withVaultWrite,
} from '@/db/encryptionState';
import { releaseEmailOwnership } from './userEmail';
import {
  authIdentities,
  encryptionProfiles,
  otpRecords,
  fileAttachments,
  notes,
  passkeyCredentials,
  sealNotes,
  secretNotes,
  users,
  type IdentityProvider,
} from '@/db/schema';
import { countSignInMethods, lockSignInMethods } from './signInMethods';

export { countSignInMethods } from './signInMethods';

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
  provider: IdentityProvider;
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

export const getUserIdentities = async (userId: string): Promise<IdentityRow[]> =>
  withVaultRead(userId, async () => {
    const rows = await getDb().select().from(authIdentities).where(eq(authIdentities.userId, userId));
    return rows.map(mapIdentity);
  });

export const linkIdentity = async (
  primaryUserId: string,
  provider: IdentityProvider,
  providerSubject: string,
  identityData: Record<string, unknown>,
) => {
  const existingRows = await getDb()
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

    // Belongs to a different user — lock both accounts in stable order before
    // checking/migrating anything. A merge that races rotation on either side
    // must fail before moving a single row.
    const secondaryUserId = existing.userId;
    const [firstId, secondId] = [primaryUserId, secondaryUserId].sort();
    return withAccountLock(firstId, async (_firstDb, firstState) => {
      if (firstState.activeRotationId) throw new VaultConflictError('ROTATION_IN_PROGRESS');
      return withAccountLock(secondId, async (_secondDb, secondState) => {
        if (secondState.activeRotationId) throw new VaultConflictError('ROTATION_IN_PROGRESS');
        const primaryState = firstId === primaryUserId ? firstState : secondState;
        if (primaryState.generation !== currentRequestGeneration()) throw new VaultConflictError('GENERATION_MISMATCH');
        const db = getDb();
        const currentRows = await db
          .select()
          .from(authIdentities)
          .where(and(eq(authIdentities.provider, provider), eq(authIdentities.providerSubject, providerSubject)))
          .limit(1);
        const current = currentRows[0];
        if (!current) {
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
          return;
        }
        if (current.userId === primaryUserId) return;

        if (current.userId !== secondaryUserId) throw new AlreadyLinkedError();
        // Every retained encrypted resource must block a merge, including
        // trash, authenticator tombstones and unlinked attachments.
        const [secretsCount, sealsCount, authCount, fileCount] = await Promise.all([
          db.select({ n: count() }).from(secretNotes).where(eq(secretNotes.userId, secondaryUserId)),
          db.select({ n: count() }).from(sealNotes).where(eq(sealNotes.userId, secondaryUserId)),
          db.select({ n: count() }).from(otpRecords).where(eq(otpRecords.userId, secondaryUserId)),
          db
            .select({ n: count() })
            .from(fileAttachments)
            .where(
              and(
                eq(fileAttachments.userId, secondaryUserId),
                eq(fileAttachments.encrypted, true),
                isNull(fileAttachments.storageDeletedAt),
              ),
            ),
        ]);

        if (
          Number(secretsCount[0].n) > 0 ||
          Number(sealsCount[0].n) > 0 ||
          Number(authCount[0].n) > 0 ||
          Number(fileCount[0].n) > 0
        ) {
          throw new ConflictEncryptedDataError();
        }

        // The merged-away account may hold the only address between the two. It
        // was proven once and shouldn't evaporate with the row — but it can only
        // move to an account that doesn't already have one, and only after the old
        // row is gone, or the two collide on the unique index mid-transaction.
        const [primaryRow, secondaryRow] = await Promise.all([
          db.select({ email: users.email }).from(users).where(eq(users.id, primaryUserId)).limit(1),
          db
            .select({ email: users.email, verifiedAt: users.emailVerifiedAt, owner: users.emailOwnerIdentityId })
            .from(users)
            .where(eq(users.id, secondaryUserId))
            .limit(1),
        ]);
        const inheritedEmail = !primaryRow[0]?.email && secondaryRow[0]?.email ? secondaryRow[0] : null;

        // Migrate notes
        await db.update(notes).set({ userId: primaryUserId }).where(eq(notes.userId, secondaryUserId));

        // Remove secondary encryption profile (if any, but no secrets/seals)
        await db.delete(encryptionProfiles).where(eq(encryptionProfiles.userId, secondaryUserId));

        // Move all identities of secondary to primary. Their ids don't change,
        // so an `email_owner_identity_id` pointing at one stays valid.
        await db
          .update(authIdentities)
          .set({ userId: primaryUserId })
          .where(eq(authIdentities.userId, secondaryUserId));

        // Passkeys are sibling sign-in methods rather than auth identities, but
        // they must follow the account through the same merge.
        await db
          .update(passkeyCredentials)
          .set({ userId: primaryUserId })
          .where(eq(passkeyCredentials.userId, secondaryUserId));

        // Delete secondary user record
        await db.delete(users).where(eq(users.id, secondaryUserId));

        if (inheritedEmail) {
          await db
            .update(users)
            .set({
              email: inheritedEmail.email,
              emailVerifiedAt: inheritedEmail.verifiedAt,
              emailOwnerIdentityId: inheritedEmail.owner,
            })
            .where(eq(users.id, primaryUserId));
        }
      });
    });
  }

  await withVaultWrite(primaryUserId, async () => {
    await getDb()
      .insert(authIdentities)
      .values({
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
  });
};

export const unlinkIdentity = async (userId: string, provider: string): Promise<boolean> => {
  return withVaultWrite(userId, async () => {
    const tx = getDb();
    if (!(await lockSignInMethods(userId, tx))) return false;

    const identity = await tx
      .select({ id: authIdentities.id })
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, provider as IdentityProvider)))
      .limit(1);
    if (!identity[0]) return false;

    if ((await countSignInMethods(userId, tx)) <= 1) throw new LastIdentityError();

    const deleted = await tx
      .delete(authIdentities)
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, provider as IdentityProvider)))
      .returning({ id: authIdentities.id });

    // The address this identity proved stays on the account — removing one
    // sign-in method must not silently remove a second. It only becomes
    // unowned, and so detachable by hand.
    await releaseEmailOwnership(
      deleted.map((row) => row.id),
      tx,
    );

    return deleted.length > 0;
  });
};
