import { type HydratedDocument, model, models, Schema, type Types } from 'mongoose';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';
import { type EncryptedPayload } from '@/types/crypto';

// A snapshot of a seal's title + encrypted body before an edit. No per-version
// wrappedNoteKey: the per-note NEK never rotates, so the head's wrapped key
// decrypts every historical body.
export type SealNoteVersion = {
  _id: Types.ObjectId;
  title: string;
  encryptedBody: EncryptedPayload | null;
  createdAt: Date;
};

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
  pattern: NotePattern | null;
  pinned: boolean;
  expiresAt: Date | null;
  burnAfterReading: boolean;
  tags: Types.ObjectId[];
  versions: SealNoteVersion[];
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

const sealNoteVersionSchema = new Schema<SealNoteVersion>({
  title: { type: String, required: true, default: '' },
  encryptedBody: { type: encryptedPayloadSchema, default: null },
  createdAt: { type: Date, required: true, default: () => new Date() },
});

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
  pattern: { type: String, enum: NOTE_PATTERNS, default: null },
  pinned: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  burnAfterReading: { type: Boolean, default: false },
  tags: { type: [{ type: Schema.Types.ObjectId, ref: 'Tag' }], default: [] },
  versions: { type: [sealNoteVersionSchema], default: [] },
});

// Compound index for userId-filtered queries
sealNoteSchema.index({ userId: 1, deletedAt: 1 });

// Multikey index for filtering by tag id.
sealNoteSchema.index({ userId: 1, tags: 1 });

// Covers the default list sort path: userId + archived prefix, pinned/position sort suffix.
sealNoteSchema.index({ userId: 1, archived: 1, pinned: -1, position: -1 });

// Covers the search-result sort path (pinned + updatedAt).
sealNoteSchema.index({ userId: 1, archived: 1, pinned: -1, updatedAt: -1 });

// TTL index — auto-delete soft-deleted notes after 1 hour
sealNoteSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// TTL index — self-destruct deletes the doc after 1 hour
sealNoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// Text search on title only (body is encrypted)
sealNoteSchema.index({ title: 'text' }, { name: 'SealNoteTextIndex' });

export const SealNoteModel = models.SealNote || model<SealNote>('SealNote', sealNoteSchema);
