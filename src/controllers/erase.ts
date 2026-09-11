import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { withVaultWrite } from '@/db/encryptionState';
import {
  authIdentities,
  encryptionProfiles,
  encryptionRotations,
  fileAttachments,
  notes,
  notificationPreferences,
  otpRecords,
  passkeyCredentials,
  rotationCleanup,
  rotationItems,
  sealNotes,
  secretNotes,
  securityPreferences,
  users,
} from '@/db/schema';
import { deleteFilesByUserId } from './files';
import { revokeAllOtherSessions } from './authSessions';

// Version and tag-join rows go with their parents via ON DELETE CASCADE.

export const eraseSeals = (userId: string) =>
  withVaultWrite(userId, async () => getDb().delete(sealNotes).where(eq(sealNotes.userId, userId)));

export const eraseSecrets = (userId: string) =>
  withVaultWrite(userId, async () => getDb().delete(secretNotes).where(eq(secretNotes.userId, userId)));

export const eraseNotes = (userId: string) =>
  withVaultWrite(userId, async () => getDb().delete(notes).where(eq(notes.userId, userId)));

/** Authenticator rows are keyed only by `userId`; nothing cascades from `users`
 *  today, so without this step a wipe would leave orphaned ciphertext behind. */
export const eraseOtp = (userId: string) =>
  withVaultWrite(userId, async () => getDb().delete(otpRecords).where(eq(otpRecords.userId, userId)));

export const eraseEncryptionProfile = (userId: string) =>
  withVaultWrite(userId, async () => getDb().delete(encryptionProfiles).where(eq(encryptionProfiles.userId, userId)));

export const eraseFiles = (userId: string) => withVaultWrite(userId, () => deleteFilesByUserId(userId));

/**
 * Rotation staging outlives its operation. A committed rotation keeps its
 * `rotation_items` — a complete copy of every re-encrypted Secret, Seal, Seal
 * version and Authenticator payload — until the object sweep has reclaimed the
 * obsolete objects and flips the phase to `cleaned`. Erasure must not wait on a
 * cron: drop the staged ciphertext here.
 *
 * The operation rows themselves hold only digests and counts, and they are what
 * `rotation_cleanup` cascades from, so an operation with objects still queued is
 * kept until that queue drains (`cleanup()` retires the drained, user-less rows).
 * `withVaultWrite` has already established that none of them is active.
 */
async function eraseRotationStaging(db: ReturnType<typeof getDb>, userId: string) {
  const rotations = await db
    .select({ id: encryptionRotations.id })
    .from(encryptionRotations)
    .where(eq(encryptionRotations.userId, userId));
  if (!rotations.length) return;
  const ids = rotations.map((row) => row.id);
  await db.delete(rotationItems).where(inArray(rotationItems.operationId, ids));
  await db.update(encryptionRotations).set({ pendingMaterial: null }).where(inArray(encryptionRotations.id, ids));
  await db
    .delete(encryptionRotations)
    .where(
      and(
        inArray(encryptionRotations.id, ids),
        sql`not exists (select 1 from ${rotationCleanup} where ${rotationCleanup.operationId} = ${encryptionRotations.id})`,
      ),
    );
}

export const eraseAccount = async (userId: string) => {
  await withVaultWrite(userId, async () => {
    const db = getDb();
    // Keep the database side of account erasure in one fenced transaction.
    // File rows remain as soft-deleted storage work until the object-store
    // cleanup pass can remove their objects safely.
    await db.update(fileAttachments).set({ deletedAt: new Date() }).where(eq(fileAttachments.userId, userId));
    await db.delete(sealNotes).where(eq(sealNotes.userId, userId));
    await db.delete(secretNotes).where(eq(secretNotes.userId, userId));
    await db.delete(notes).where(eq(notes.userId, userId));
    await db.delete(otpRecords).where(eq(otpRecords.userId, userId));
    await eraseRotationStaging(db, userId);
    await db.delete(encryptionProfiles).where(eq(encryptionProfiles.userId, userId));
    await db.delete(authIdentities).where(eq(authIdentities.userId, userId));
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    await db.delete(securityPreferences).where(eq(securityPreferences.userId, userId));
    await db.delete(passkeyCredentials).where(eq(passkeyCredentials.userId, userId));
    // Retain the epoch tombstone: deleting it would make old epoch-zero tokens
    // valid again while their signed JWTs are still within their lifetime.
    await revokeAllOtherSessions(userId, '');
    await db.delete(users).where(eq(users.id, userId));
  });
};
