import mongoose from 'mongoose';
import type { Address } from 'viem';
import { AuthIdentityModel } from '../../src/models/AuthIdentity';
import { UserModel } from '../../src/models/User';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';

/**
 * Returns the MongoDB _id string for the user with the given SIWE address,
 * creating the user + identity if they don't exist yet.
 * Fixtures call this before inserting note/secret/seal/encryptionProfile documents.
 */
export const getOrCreateUserId = async (address: Address): Promise<string> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const now = new Date();
  const addressLower = address.toLowerCase();

  const existingIdentity = await AuthIdentityModel.findOne({
    provider: 'siwe',
    providerSubject: addressLower,
  }).lean();

  if (existingIdentity) {
    return existingIdentity.userId;
  }

  const user = await UserModel.create({ displayName: address, createdAt: now });

  await AuthIdentityModel.create({
    userId: user._id.toString(),
    provider: 'siwe',
    providerSubject: addressLower,
    lastLoginAt: now,
    rawProfileJson: { addressLower, addressChecksum: address },
  });

  return user._id.toString();
};
