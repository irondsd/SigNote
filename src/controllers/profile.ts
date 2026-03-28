import { Address } from 'viem';

import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { UserModel } from '@/models/User';
import { EncryptionProfileModel } from '@/models/EncryptionProfile';

export const getProfileData = async (address: Address) => {
  const [user, notesCount, secretsCount, sealsCount, encryptionProfileExists] = await Promise.all([
    UserModel.findOne({ addressLower: address.toLowerCase() })
      .select({ addressChecksum: 1, createdAt: 1 })
      .lean()
      .exec(),
    NoteModel.countDocuments({ address, deletedAt: null }),
    SecretNoteModel.countDocuments({ address, deletedAt: null }),
    SealNoteModel.countDocuments({ address, deletedAt: null }),
    EncryptionProfileModel.exists({ walletAddress: address.toLowerCase() }),
  ]);

  if (!user) return null;

  return {
    address: user.addressChecksum,
    createdAt: user.createdAt,
    notesCount,
    secretsCount,
    sealsCount,
    hasEncryptionProfile: encryptionProfileExists !== null,
  };
};
