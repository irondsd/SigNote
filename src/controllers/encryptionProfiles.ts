import { type EncryptedPayload, type KdfParams, EncryptionProfileModel } from '@/models/EncryptionProfile';

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

export const getProfileByAddress = async (address: string) => {
  const profile = await EncryptionProfileModel.findOne({ walletAddress: address.toLowerCase() })
    .select({ walletAddress: 1, version: 1, salt: 1, kdf: 1, keyCheck: 1 })
    .lean()
    .exec();

  return profile;
};

export const getMaterialByAddress = async (address: string) => {
  const profile = await EncryptionProfileModel.findOne({ walletAddress: address.toLowerCase() })
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

export const updateProfile = async (address: string, data: UpdateProfileInput) => {
  const result = await EncryptionProfileModel.findOneAndUpdate(
    { walletAddress: address.toLowerCase() },
    { $set: { ...data, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
    .lean()
    .exec();

  if (!result) throw new Error('Profile not found');
  return result;
};

export const createProfile = async (address: string, data: CreateProfileInput) => {
  const existing = await EncryptionProfileModel.findOne({ walletAddress: address.toLowerCase() }).lean().exec();

  if (existing) {
    throw new ProfileAlreadyExistsError();
  }

  const now = new Date();
  const profile = await EncryptionProfileModel.create({
    walletAddress: address.toLowerCase(),
    ...data,
    createdAt: now,
    updatedAt: now,
  });

  return profile;
};
