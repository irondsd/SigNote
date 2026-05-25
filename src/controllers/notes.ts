import { NoteModel } from '@/models/Note';
import { commonOps, createEntity, getByIdActive, listByUserId } from './common';

export const noteOps = commonOps(NoteModel);
export const deleteNote = noteOps.softDelete;
export const undeleteNote = noteOps.restore;
export const archiveNote = noteOps.archive;
export const unarchiveNote = noteOps.unarchive;
export const updateNoteColor = noteOps.updateColor;
export const updateNotePattern = noteOps.updatePattern;
export const updateNotePosition = noteOps.updatePosition;

export const createNote = (
  userId: string,
  title: string,
  content: string,
  color?: string | null,
  pattern?: string | null,
) => createEntity(NoteModel, userId, { title, content }, color, pattern);

export const getNotesByUserId = (userId: string, archived?: boolean, limit = 30, offset = 0, search = '') =>
  listByUserId(NoteModel, userId, { archived, limit, offset, search, searchFields: ['title', 'content'] });

export const getNoteById = (id: string) => getByIdActive(NoteModel, id);

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
