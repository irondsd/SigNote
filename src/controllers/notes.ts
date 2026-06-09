import { MAX_VERSIONS } from '@/config/constants';
import { NoteModel, type NoteVersion } from '@/models/Note';
import { commonOps, createEntity, getByIdActive, listByUserId } from './common';
import { buildVersionPush } from './versions';

export const noteOps = commonOps(NoteModel);
export const deleteNote = noteOps.softDelete;
export const undeleteNote = noteOps.restore;
export const archiveNote = noteOps.archive;
export const unarchiveNote = noteOps.unarchive;
export const updateNoteColor = noteOps.updateColor;
export const updateNotePattern = noteOps.updatePattern;
export const updateNotePosition = noteOps.updatePosition;

export const updateNoteTags = noteOps.updateTags;

export const createNote = (
  userId: string,
  title: string,
  content: string,
  color?: string | null,
  pattern?: string | null,
  tags?: string[],
) => createEntity(NoteModel, userId, { title, content }, color, pattern, tags);

export const getNotesByUserId = (
  userId: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
  tagIds?: string[],
  tagMode: 'or' | 'and' = 'or',
) =>
  listByUserId(NoteModel, userId, {
    archived,
    limit,
    offset,
    search,
    searchFields: ['title', 'content'],
    tagIds,
    tagMode,
  });

export const getNoteById = (id: string) => getByIdActive(NoteModel, id);

export const updateNote = async (id: string, title: string, content: string) => {
  const doc = await NoteModel.findById(id).exec();
  if (!doc) return null;

  // No-op edit: don't touch updatedAt or record a version.
  if (doc.title === title && doc.content === content) return doc;

  const now = new Date();
  const versionPush = buildVersionPush(doc, {
    title: doc.title,
    content: doc.content,
    createdAt: now,
  });

  return NoteModel.findByIdAndUpdate(
    id,
    { $set: { title, content, updatedAt: now }, ...versionPush },
    { returnDocument: 'after' },
  ).exec();
};

/**
 * Restores a past version into the head. Unlike a normal edit, restore always
 * records a snapshot of the current head first (so the restore is itself
 * reversible) and bypasses the compression window. The restored version row is
 * left in place — restore is "edit head to match vN", not "move vN to head".
 */
export const restoreNoteVersion = async (id: string, versionId: string) => {
  const doc = await NoteModel.findById(id).exec();
  if (!doc) return null;

  const version = doc.versions.find((v: NoteVersion) => v._id.toString() === versionId);
  if (!version) return null;

  const now = new Date();

  return NoteModel.findByIdAndUpdate(
    id,
    {
      $set: { title: version.title, content: version.content, updatedAt: now },
      $push: {
        versions: {
          $each: [{ title: doc.title, content: doc.content, createdAt: now }],
          $slice: -MAX_VERSIONS,
        },
      },
    },
    { returnDocument: 'after' },
  ).exec();
};
