import mongoose from 'mongoose';
import { AuthIdentityModel } from '../../src/models/AuthIdentity';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';

/**
 * Adds a Google identity to an existing user (by userId).
 * Used in tests that need a user with multiple linked sign-in methods.
 */
export const addGoogleIdentityToUser = async (userId: string, googleId: string, email: string): Promise<void> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const now = new Date();

  await AuthIdentityModel.create({
    userId,
    provider: 'google',
    providerSubject: googleId,
    email,
    emailVerified: true,
    lastLoginAt: now,
    rawProfileJson: { sub: googleId, email, name: email, email_verified: true },
  });
};
