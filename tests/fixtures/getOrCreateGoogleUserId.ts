import mongoose from 'mongoose';
import { AuthIdentityModel } from '../../src/models/AuthIdentity';
import { UserModel } from '../../src/models/User';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';

/**
 * Returns the MongoDB _id string for the user with the given Google ID,
 * creating the user + identity if they don't exist yet.
 */
export const getOrCreateGoogleUserId = async (googleId: string, email: string): Promise<string> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const now = new Date();

  const existingIdentity = await AuthIdentityModel.findOne({
    provider: 'google',
    providerSubject: googleId,
  }).lean();

  if (existingIdentity) {
    return existingIdentity.userId;
  }

  const user = await UserModel.create({ displayName: email, createdAt: now });

  await AuthIdentityModel.create({
    userId: user._id.toString(),
    provider: 'google',
    providerSubject: googleId,
    email,
    emailVerified: true,
    lastLoginAt: now,
    rawProfileJson: { sub: googleId, email, name: email, email_verified: true },
  });

  return user._id.toString();
};
