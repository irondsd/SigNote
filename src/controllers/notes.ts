import { MAX_SEARCH } from '@/config/constants';
import { NoteModel } from '@/models/Note';
import { getNextPosition } from '@/utils/calculatePosition';
import { escapeRegExp } from '@/utils/regexUtils';
import { commonOps } from './common';

export const noteOps = commonOps(NoteModel);
export const deleteNote = noteOps.softDelete;
export const undeleteNote = noteOps.restore;
export const archiveNote = noteOps.archive;
export const unarchiveNote = noteOps.unarchive;
export const updateNoteColor = noteOps.updateColor;
export const updateNotePattern = noteOps.updatePattern;
export const updateNotePosition = noteOps.updatePosition;

export const createNote = async (
  userId: string,
  title: string,
  content: string,
  color?: string | null,
  pattern?: string | null,
) => {
  const now = new Date();
  const position = await getNextPosition(NoteModel, userId);

  const note = await NoteModel.create({
    userId,
    title,
    content,
    position,
    ...(color != null && { color }),
    ...(pattern != null && { pattern }),
    createdAt: now,
    updatedAt: now,
  });

  return note;
};

export const getNotesByUserId = async (userId: string, archived?: boolean, limit = 30, offset = 0, search = '') => {
  const baseQuery = { userId, ...(archived !== undefined && { archived }), deletedAt: null };
  const normalizedSearch = search.trim().slice(0, MAX_SEARCH);

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
