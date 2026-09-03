import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { authIdentities, encryptionProfiles, notes, sealNotes, secretNotes, users } from '@/db/schema';
import { deleteFilesByUserId } from './files';

// Version and tag-join rows go with their parents via ON DELETE CASCADE.

export const eraseSeals = (userId: string) => getDb().delete(sealNotes).where(eq(sealNotes.userId, userId));

export const eraseSecrets = (userId: string) => getDb().delete(secretNotes).where(eq(secretNotes.userId, userId));

export const eraseNotes = (userId: string) => getDb().delete(notes).where(eq(notes.userId, userId));

export const eraseEncryptionProfile = (userId: string) =>
  getDb().delete(encryptionProfiles).where(eq(encryptionProfiles.userId, userId));

export const eraseFiles = (userId: string) => deleteFilesByUserId(userId);

export const eraseAccount = async (userId: string) => {
  await Promise.all([
    getDb().delete(users).where(eq(users.id, userId)),
    getDb().delete(authIdentities).where(eq(authIdentities.userId, userId)),
  ]);
};
