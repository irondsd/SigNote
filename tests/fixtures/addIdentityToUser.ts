import { authIdentities } from '../../src/db/schema';
import { testDb } from './db';

/**
 * Adds a Google identity to an existing user (by userId).
 * Used in tests that need a user with multiple linked sign-in methods.
 */
export const addGoogleIdentityToUser = async (userId: string, googleId: string, email: string): Promise<void> => {
  await testDb()
    .insert(authIdentities)
    .values({
      userId,
      provider: 'google',
      providerSubject: googleId,
      email,
      emailVerified: true,
      lastLoginAt: new Date(),
      rawProfileJson: { sub: googleId, email, name: email, email_verified: true },
    });
};
