import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { Address } from 'viem';

export type Note = {
  address: Address;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  archived: boolean;
};

export type NoteDocument = HydratedDocument<Note>;

const noteSchema = new Schema<Note>({
  address: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    unique: true,
    index: true,
  },
  content: {
    type: String,
  },
  createdAt: {
    type: Date,
    required: true,
    default: () => new Date(),
  },
  updatedAt: {
    type: Date,
    required: true,
    default: () => new Date(),
  },
  archived: {
    type: Boolean,
    default: false,
  },
});

export const NoteModel = models.Note || model<Note>('Note', noteSchema);
