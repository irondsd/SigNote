import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { type EncryptedPayload } from '@/types/crypto';

export type SealNote = {
  userId: string;
  title: string; // plaintext
  encryptedBody: EncryptedPayload | null;
  wrappedNoteKey: EncryptedPayload | null; // per-note NEK wrapped with sealWrapKey
  position: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archived: boolean;
  color: NoteColor | null;
};

export type SealNoteDocument = HydratedDocument<SealNote>;

const encryptedPayloadSchema = new Schema<EncryptedPayload>(
  {
    alg: { type: String, required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false },
);

const sealNoteSchema = new Schema<SealNote>({
  userId: { type: String, required: true },
  title: { type: String, index: true },
  encryptedBody: { type: encryptedPayloadSchema, default: null },
  wrappedNoteKey: { type: encryptedPayloadSchema, default: null },
  position: { type: Number, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  updatedAt: { type: Date, required: true, default: () => new Date() },
  deletedAt: { type: Date, default: null },
  archived: { type: Boolean, default: false },
  color: { type: String, enum: NOTE_COLORS, default: null },
});

// Compound index for userId-filtered queries
sealNoteSchema.index({ userId: 1, deletedAt: 1 });

// TTL index — auto-delete soft-deleted notes after 1 hour
sealNoteSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// Text search on title only (body is encrypted)
sealNoteSchema.index({ title: 'text' }, { name: 'SealNoteTextIndex' });

export const SealNoteModel = models.SealNote || model<SealNote>('SealNote', sealNoteSchema);
