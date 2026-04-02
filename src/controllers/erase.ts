import { AuthIdentityModel } from '@/models/AuthIdentity';
import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { EncryptionProfileModel } from '@/models/EncryptionProfile';
import { UserModel } from '@/models/User';

export const eraseSeals = (userId: string) => SealNoteModel.deleteMany({ userId });

export const eraseSecrets = (userId: string) => SecretNoteModel.deleteMany({ userId });

export const eraseNotes = (userId: string) => NoteModel.deleteMany({ userId });

export const eraseEncryptionProfile = (userId: string) => EncryptionProfileModel.deleteOne({ userId });

export const eraseAccount = async (userId: string) => {
  await Promise.all([UserModel.deleteOne({ _id: userId }), AuthIdentityModel.deleteMany({ userId })]);
};
