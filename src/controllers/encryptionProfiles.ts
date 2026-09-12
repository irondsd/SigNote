import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { currentRequestGeneration, withVaultRead, withVaultWrite } from '@/db/encryptionState';
import { encryptionProfiles } from '@/db/schema';
import { type EncryptedPayload, type KdfParams } from '@/types/crypto';

type CreateProfileInput = {
  version: number;
  serverShare: string;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};

export class ProfileAlreadyExistsError extends Error {
  constructor() {
    super('Encryption profile already exists');
    this.name = 'ProfileAlreadyExistsError';
  }
}

export const getProfileByUserId = async (userId: string) => {
  return withVaultRead(userId, async ({ generation }) => {
    const rows = await getDb()
      .select({
        id: encryptionProfiles.id,
        userId: encryptionProfiles.userId,
        version: encryptionProfiles.version,
        salt: encryptionProfiles.salt,
        kdf: encryptionProfiles.kdf,
        keyCheck: encryptionProfiles.keyCheck,
      })
      .from(encryptionProfiles)
      .where(eq(encryptionProfiles.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const { id, ...rest } = row;
    return { _id: id, ...rest, generation };
  });
};

export const getMaterialByUserId = async (userId: string) => {
  return withVaultRead(userId, async ({ generation }) => {
    const rows = await getDb()
      .select({
        id: encryptionProfiles.id,
        version: encryptionProfiles.version,
        serverShare: encryptionProfiles.serverShare,
        salt: encryptionProfiles.salt,
        kdf: encryptionProfiles.kdf,
        keyCheck: encryptionProfiles.keyCheck,
      })
      .from(encryptionProfiles)
      .where(eq(encryptionProfiles.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const { id, ...rest } = row;
    return { _id: id, ...rest, generation };
  });
};

type UpdateProfileInput = {
  serverShare: string;
  salt: string;
  keyCheck: EncryptedPayload;
};

export const updateProfile = async (userId: string, data: UpdateProfileInput) => {
  return withVaultWrite(userId, async () => {
    const rows = await getDb()
      .update(encryptionProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(encryptionProfiles.userId, userId))
      .returning();

    if (!rows[0]) throw new Error('Profile not found');
    const { id, ...rest } = rows[0];
    return { _id: id, ...rest, generation: currentRequestGeneration() };
  });
};

export const createProfile = async (userId: string, data: CreateProfileInput) => {
  return withVaultWrite(userId, async () => {
    const db = getDb();
    const existing = await db
      .select({ id: encryptionProfiles.id })
      .from(encryptionProfiles)
      .where(eq(encryptionProfiles.userId, userId))
      .limit(1);

    if (existing[0]) {
      throw new ProfileAlreadyExistsError();
    }

    const now = new Date();
    const rows = await db
      .insert(encryptionProfiles)
      .values({ userId, ...data, createdAt: now, updatedAt: now })
      .returning();
    const { id, ...rest } = rows[0];
    return { _id: id, ...rest, generation: currentRequestGeneration() };
  });
};
