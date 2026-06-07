import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';
import { type EncryptedPayload } from '@/types/crypto';

export type SecretNote = {
  userId: string;
  title: string; // plaintext
  encryptedBody: EncryptedPayload | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archived: boolean;
  color: NoteColor | null;
  pattern: NotePattern | null;
  pinned: boolean;
  expiresAt: Date | null;
  burnAfterReading: boolean;
  tags: string[];
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
  userId: { type: String, required: true },
  title: { type: String, index: true },
  encryptedBody: { type: encryptedPayloadSchema, default: null },
  position: { type: Number, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  updatedAt: { type: Date, required: true, default: () => new Date() },
  deletedAt: { type: Date, default: null },
  archived: { type: Boolean, default: false },
  color: { type: String, enum: NOTE_COLORS, default: null },
  pattern: { type: String, enum: NOTE_PATTERNS, default: null },
  pinned: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  burnAfterReading: { type: Boolean, default: false },
  tags: { type: [String], default: [] },
});

// Compound index for userId-filtered queries
secretNoteSchema.index({ userId: 1, deletedAt: 1 });

// Multikey index for filtering by tag id.
secretNoteSchema.index({ userId: 1, tags: 1 });

// Covers the default list sort path: userId + archived prefix, pinned/position sort suffix.
secretNoteSchema.index({ userId: 1, archived: 1, pinned: -1, position: -1 });

// Covers the search-result sort path (pinned + updatedAt).
secretNoteSchema.index({ userId: 1, archived: 1, pinned: -1, updatedAt: -1 });

// TTL index — auto-delete soft-deleted notes after 1 hour
secretNoteSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// TTL index — self-destruct deletes the doc after 1 hour
secretNoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// Text search on title only (body is encrypted)
secretNoteSchema.index({ title: 'text' }, { name: 'SecretNoteTextIndex' });

export const SecretNoteModel = models.SecretNote || model<SecretNote>('SecretNote', secretNoteSchema);
