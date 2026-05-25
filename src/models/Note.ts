import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';

export type Note = {
  userId: string;
  title: string;
  content: string;
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
};

export type NoteDocument = HydratedDocument<Note>;

const noteSchema = new Schema<Note>({
  userId: { type: String, required: true },
  title: { type: String, index: true },
  content: { type: String },
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
});

// Compound index for userId-filtered queries (the most common access pattern)
noteSchema.index({ userId: 1, deletedAt: 1 });

// Covers the default list sort path: userId + archived prefix, pinned/position sort suffix.
noteSchema.index({ userId: 1, archived: 1, pinned: -1, position: -1 });

// Covers the search-result sort path (pinned + updatedAt).
noteSchema.index({ userId: 1, archived: 1, pinned: -1, updatedAt: -1 });

// TTL index to automatically delete soft-deleted notes after 1 hour
noteSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// TTL index — self-destruct deletes the doc after 1 hour
noteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// Full-text index for search with title relevance boost
noteSchema.index(
  { title: 'text', content: 'text' },
  {
    weights: { title: 10, content: 2 },
    name: 'NoteTextIndex',
  },
);

export const NoteModel = models.Note || model<Note>('Note', noteSchema);
