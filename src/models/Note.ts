import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { Address } from 'viem';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';

export type Note = {
  address: Address;
  title: string;
  content: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archived: boolean;
  color: NoteColor | null;
};

export type NoteDocument = HydratedDocument<Note>;

const noteSchema = new Schema<Note>({
  address: { type: String, required: true },
  title: { type: String, index: true },
  content: { type: String },
  position: { type: Number, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  updatedAt: { type: Date, required: true, default: () => new Date() },
  deletedAt: { type: Date, default: null },
  archived: { type: Boolean, default: false },
  color: { type: String, enum: NOTE_COLORS, default: null },
});

// TTL index to automatically delete soft-deleted notes after 1 hour
noteSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

// Full-text index for search with title relevance boost
noteSchema.index(
  { title: 'text', content: 'text' },
  {
    weights: { title: 10, content: 2 },
    name: 'NoteTextIndex',
  },
);

export const NoteModel = models.Note || model<Note>('Note', noteSchema);
