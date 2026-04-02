import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { UserModel } from '@/models/User';
import { EncryptionProfileModel } from '@/models/EncryptionProfile';

export const getProfileData = async (userId: string) => {
  const [user, notesCount, secretsCount, sealsCount, encryptionProfileExists] = await Promise.all([
    UserModel.findById(userId).select({ displayName: 1, createdAt: 1 }).lean().exec(),
    NoteModel.countDocuments({ userId, deletedAt: null }),
    SecretNoteModel.countDocuments({ userId, deletedAt: null }),
    SealNoteModel.countDocuments({ userId, deletedAt: null }),
    EncryptionProfileModel.findOne({ userId }).select({ createdAt: 1 }).lean().exec(),
  ]);

  if (!user) return null;

  return {
    displayName: user.displayName,
    createdAt: user.createdAt,
    notesCount,
    secretsCount,
    sealsCount,
    hasEncryptionProfile: encryptionProfileExists !== null,
    encryptionProfileCreatedAt: encryptionProfileExists?.createdAt ?? null,
  };
};
