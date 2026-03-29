import { EncryptionProfileModel } from '@/models/EncryptionProfile';
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
  const profile = await EncryptionProfileModel.findOne({ userId })
    .select({ userId: 1, version: 1, salt: 1, kdf: 1, keyCheck: 1 })
    .lean()
    .exec();

  return profile;
};

export const getMaterialByUserId = async (userId: string) => {
  const profile = await EncryptionProfileModel.findOne({ userId })
    .select({ version: 1, serverShare: 1, salt: 1, kdf: 1, keyCheck: 1 })
    .lean()
    .exec();

  return profile;
};

type UpdateProfileInput = {
  serverShare: string;
  salt: string;
  keyCheck: EncryptedPayload;
};

export const updateProfile = async (userId: string, data: UpdateProfileInput) => {
  const result = await EncryptionProfileModel.findOneAndUpdate(
    { userId },
    { $set: { ...data, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
    .lean()
    .exec();

  if (!result) throw new Error('Profile not found');
  return result;
};

export const createProfile = async (userId: string, data: CreateProfileInput) => {
  const existing = await EncryptionProfileModel.findOne({ userId }).lean().exec();

  if (existing) {
    throw new ProfileAlreadyExistsError();
  }

  const now = new Date();
  const profile = await EncryptionProfileModel.create({
    userId,
    ...data,
    createdAt: now,
    updatedAt: now,
  });

  return profile;
};
