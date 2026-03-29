import mongoose from 'mongoose';
import type { Address } from 'viem';
import { UserModel } from '../../src/models/User';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';

/**
 * Returns the MongoDB _id string for the user with the given address,
 * creating the user if it doesn't exist yet. Fixtures call this before
 * inserting note/secret/seal/encryptionProfile documents.
 */
export const getOrCreateUserId = async (address: Address): Promise<string> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const now = new Date();
  const addressLower = address.toLowerCase() as Address;

  const user = await UserModel.findOneAndUpdate(
    { addressLower },
    {
      $set: { addressChecksum: address, lastLoginAt: now },
      $setOnInsert: { addressLower, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );

  return user._id.toString();
};
