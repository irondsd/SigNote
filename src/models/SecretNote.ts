import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { type Address } from 'viem';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { type EncryptedPayload } from './EncryptionProfile';

export type SecretNote = {
  address: Address;
  title: string; // plaintext
  encryptedBody: EncryptedPayload | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archived: boolean;
  color: NoteColor | null;
};

export type SecretNoteDocument = HydratedDocument<SecretNote>;

const encryptedPayloadSchema = new Schema<EncryptedPayload>(
  {
    alg: { type: String, required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false },
);

const secretNoteSchema = new Schema<SecretNote>({
  address: { type: String, required: true },
  title: { type: String, index: true },
  encryptedBody: { type: encryptedPayloadSchema, default: null },
  position: { type: Number, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  updatedAt: { type: Date, required: true, default: () => new Date() },
  deletedAt: { type: Date, default: null },
  archived: { type: Boolean, default: false },
  color: { type: String, enum: NOTE_COLORS, default: null },
});

// TTL index — auto-delete soft-deleted notes after 1 hour
secretNoteSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// Text search on title only (body is encrypted)
secretNoteSchema.index({ title: 'text' }, { name: 'SecretNoteTextIndex' });

export const SecretNoteModel = models.SecretNote || model<SecretNote>('SecretNote', secretNoteSchema);
