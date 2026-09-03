import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
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
  return { _id: id, ...rest };
};

export const getMaterialByUserId = async (userId: string) => {
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
  return { _id: id, ...rest };
};

type UpdateProfileInput = {
  serverShare: string;
  salt: string;
  keyCheck: EncryptedPayload;
};

export const updateProfile = async (userId: string, data: UpdateProfileInput) => {
  const rows = await getDb()
    .update(encryptionProfiles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(encryptionProfiles.userId, userId))
    .returning();

  if (!rows[0]) throw new Error('Profile not found');
  const { id, ...rest } = rows[0];
  return { _id: id, ...rest };
};

export const createProfile = async (userId: string, data: CreateProfileInput) => {
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
  return { _id: id, ...rest };
};
