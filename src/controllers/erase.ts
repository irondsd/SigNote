import { type Address } from 'viem';

import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { EncryptionProfileModel } from '@/models/EncryptionProfile';
import { UserModel } from '@/models/User';

export const eraseSeals = (address: Address) => SealNoteModel.deleteMany({ address });

export const eraseSecrets = (address: Address) => SecretNoteModel.deleteMany({ address });

export const eraseNotes = (address: Address) => NoteModel.deleteMany({ address });

export const eraseEncryptionProfile = (address: Address) =>
  EncryptionProfileModel.deleteOne({ walletAddress: address.toLowerCase() });

export const eraseAccount = (address: Address) => UserModel.deleteOne({ addressLower: address.toLowerCase() });
