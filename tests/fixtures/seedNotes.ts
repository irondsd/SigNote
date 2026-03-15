import mongoose from 'mongoose';
import type { Address } from 'viem';
import { NoteModel, type NoteDocument } from '../../src/models/Note';
import type { NoteColor } from '../../src/config/noteColors';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';
const POSITION_STEP = 1000;

export type SeedNote = {
  title?: string;
  content?: string;
  archived?: boolean;
  color?: NoteColor | null;
};

export const seedNotes = async (address: Address, notes: SeedNote[]): Promise<NoteDocument[]> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  // Determine starting position after existing notes for this address
  const lastNote = await NoteModel.findOne({ address, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  let position = (lastNote?.position ?? 0) + POSITION_STEP;

  const created: NoteDocument[] = [];
  for (const note of notes) {
    const now = new Date();
    const doc = await NoteModel.create({
      address,
      title: note.title ?? '',
      content: note.content ?? '<p></p>',
      archived: note.archived ?? false,
      color: note.color ?? null,
      position,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    created.push(doc);
    position += POSITION_STEP;
  }

  return created;
};
