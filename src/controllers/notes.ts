import { POSITION_STEP } from '@/config/constants';
import { NoteModel } from '@/models/Note';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getNextPosition = async (userId: string) => {
  const lastNote = await NoteModel.findOne({ userId, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  return (lastNote?.position ?? 0) + POSITION_STEP;
};

export const createNote = async (userId: string, title: string, content: string) => {
  const now = new Date();
  const position = await getNextPosition(userId);

  const note = await NoteModel.create({
    userId,
    title,
    content,
    position,
    createdAt: now,
    updatedAt: now,
  });

  return note;
};

export const getNotesByUserId = async (userId: string, archived?: boolean, limit = 30, offset = 0, search = '') => {
  const baseQuery = { userId, ...(archived !== undefined && { archived }), deletedAt: null };
  const normalizedSearch = search.trim();

  if (!normalizedSearch) {
    return NoteModel.find(baseQuery).sort({ position: -1 }).skip(offset).limit(limit).exec();
  }

  const safeSearchRegex = new RegExp(escapeRegExp(normalizedSearch), 'i');

  return NoteModel.find({
    ...baseQuery,
    $or: [{ title: safeSearchRegex }, { content: safeSearchRegex }],
  })
    .sort({ updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .exec();
};

export const getNoteById = async (id: string) => {
  return NoteModel.findById(id).exec();
};

export const updateNote = async (id: string, title: string, content: string) => {
  const now = new Date();

  return NoteModel.findByIdAndUpdate(
    id,
    {
      title,
      content,
      updatedAt: now,
    },
    {
      returnDocument: 'after',
    },
  ).exec();
};

export const deleteNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { returnDocument: 'after' }).exec();
};

export const undeleteNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { deletedAt: null }, { returnDocument: 'after' }).exec();
};

export const archiveNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { archived: true }, { returnDocument: 'after' }).exec();
};

export const unarchiveNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { archived: false }, { returnDocument: 'after' }).exec();
};

export const updateNoteColor = async (id: string, color: string | null) => {
  return NoteModel.findByIdAndUpdate(id, { color }, { returnDocument: 'after' }).exec();
};

export const updateNotePosition = async (id: string, position: number) => {
  return NoteModel.findByIdAndUpdate(id, { position }, { returnDocument: 'after' }).exec();
};
