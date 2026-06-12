import { isValidObjectId, Types } from 'mongoose';
import { MAX_VERSIONS } from '@/config/constants';
import { NoteModel } from '@/models/Note';
import {
  commonOps,
  createEntity,
  deleteVersionById,
  getByIdActive,
  getVersionsByIdActive,
  listByUserId,
} from './common';
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
export const getNoteVersions = (id: string) => getVersionsByIdActive(NoteModel, id);
export const deleteNoteVersion = (id: string, versionId: string) => deleteVersionById(NoteModel, id, versionId);

export const updateNote = async (id: string, title: string, content: string) => {
  // $slice keeps every other field but loads only the newest version — all the
  // no-op check and the compression-window decision need.
  const doc = await NoteModel.findById(id)
    .select({ versions: { $slice: -1 } })
    .exec();
  if (!doc) return null;

  // No-op edit: don't touch updatedAt or record a version. Re-read without the
  // version slice so the response carries no history, same as a real update.
  if (doc.title === title && doc.content === content) {
    return NoteModel.findById(id).select('-versions').exec();
  }

  const now = new Date();
  // The snapshot is stamped with when its content was *saved* (the head's
  // updatedAt), not when this edit displaced it.
  const versionPush = buildVersionPush(doc, {
    title: doc.title,
    content: doc.content,
    createdAt: doc.updatedAt,
  });

  return NoteModel.findByIdAndUpdate(
    id,
    { $set: { title, content, updatedAt: now }, ...versionPush },
    { returnDocument: 'after', projection: { versions: 0 } },
  ).exec();
};

/**
 * Restores a past version into the head. Unlike a normal edit, restore always
 * records a snapshot of the current head first (so the restore is itself
 * reversible) and bypasses the compression window. The restored version row is
 * left in place — restore is "edit head to match vN", not "move vN to head".
 */
export const restoreNoteVersion = async (id: string, versionId: string) => {
  if (!isValidObjectId(versionId)) return null;

  // $elemMatch loads only the targeted version alongside the head fields.
  const doc = await NoteModel.findById(id)
    .select({ title: 1, content: 1, updatedAt: 1, versions: { $elemMatch: { _id: new Types.ObjectId(versionId) } } })
    .exec();
  if (!doc) return null;

  const version = doc.versions?.[0];
  if (!version) return null;

  const now = new Date();

  return NoteModel.findByIdAndUpdate(
    id,
    {
      $set: { title: version.title, content: version.content, updatedAt: now },
      $push: {
        versions: {
          // Stamped with when the pre-restore head was saved, not restore time.
          $each: [{ title: doc.title, content: doc.content, createdAt: doc.updatedAt }],
          $slice: -MAX_VERSIONS,
        },
      },
    },
    { returnDocument: 'after', projection: { versions: 0 } },
  ).exec();
};
