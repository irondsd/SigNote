import { AuthIdentityModel } from '@/models/AuthIdentity';
import { UserModel } from '@/models/User';
import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { EncryptionProfileModel } from '@/models/EncryptionProfile';
import connectToDatabase from '@/utils/mongoose';

export class ConflictEncryptedDataError extends Error {
  constructor() {
    super('CONFLICT_ENCRYPTED_DATA');
    this.name = 'ConflictEncryptedDataError';
  }
}

export class AlreadyLinkedError extends Error {
  constructor() {
    super('ALREADY_LINKED');
    this.name = 'AlreadyLinkedError';
  }
}

export class LastIdentityError extends Error {
  constructor() {
    super('LAST_IDENTITY');
    this.name = 'LastIdentityError';
  }
}

export const getUserIdentities = async (userId: string) => {
  await connectToDatabase();
  return AuthIdentityModel.find({ userId }).lean().exec();
};

export const linkIdentity = async (
  primaryUserId: string,
  provider: 'google' | 'siwe',
  providerSubject: string,
  identityData: Record<string, unknown>,
) => {
  await connectToDatabase();

  const existing = await AuthIdentityModel.findOne({ provider, providerSubject });

  if (existing) {
    if (existing.userId === primaryUserId) {
      // Already linked to this user — no-op
      return;
    }

    // Belongs to a different user — check for encrypted data
    const secondaryUserId = existing.userId;
    const [secretsCount, sealsCount] = await Promise.all([
      SecretNoteModel.countDocuments({ userId: secondaryUserId, deletedAt: null }),
      SealNoteModel.countDocuments({ userId: secondaryUserId, deletedAt: null }),
    ]);

    if (secretsCount > 0 || sealsCount > 0) {
      throw new ConflictEncryptedDataError();
    }

    // Migrate notes
    await NoteModel.updateMany({ userId: secondaryUserId }, { $set: { userId: primaryUserId } });

    // Remove secondary encryption profile (if any, but no secrets/seals)
    await EncryptionProfileModel.deleteOne({ userId: secondaryUserId });

    // Move all identities of secondary to primary
    await AuthIdentityModel.updateMany({ userId: secondaryUserId }, { $set: { userId: primaryUserId } });

    // Delete secondary user record
    await UserModel.deleteOne({ _id: secondaryUserId });

    return;
  }

  // Check if this provider is already linked to another user (shouldn't happen given above, but safety check)
  // (covered above since we found no existing identity)

  await AuthIdentityModel.create({
    userId: primaryUserId,
    provider,
    providerSubject,
    lastLoginAt: new Date(),
    ...identityData,
  });
};

export const unlinkIdentity = async (userId: string, provider: string) => {
  await connectToDatabase();

  const count = await AuthIdentityModel.countDocuments({ userId });
  if (count <= 1) {
    throw new LastIdentityError();
  }

  const result = await AuthIdentityModel.deleteOne({ userId, provider });
  return result.deletedCount > 0;
};
