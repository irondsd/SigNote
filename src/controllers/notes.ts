import { noteTier } from '@/db/tiers';
import type { TierHeadRow } from '@/db/tier';

export type NoteRow = TierHeadRow & { content: string };

export const noteOps = noteTier.ops;
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
) => noteTier.create(userId, { title, content }, color, pattern, tags) as Promise<NoteRow>;

export const getNotesByUserId = (
  userId: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
  tagIds?: string[],
  tagMode: 'or' | 'and' = 'or',
) => noteTier.list(userId, { archived, limit, offset, search, tagIds, tagMode }) as Promise<NoteRow[]>;

export const getNoteById = (id: string) => noteTier.getByIdActive(id) as Promise<NoteRow | null>;
export const getNoteVersions = (id: string) => noteTier.getVersionsByIdActive(id);
export const deleteNoteVersion = (id: string, versionId: string) =>
  noteTier.deleteVersionById(id, versionId) as Promise<NoteRow | null>;

export const updateNote = (id: string, title: string, content: string) =>
  noteTier.updateWithVersion(id, (head) => ({
    // No-op edit: don't touch updatedAt or record a version.
    changed: !(head.title === title && head.content === content),
    set: { title, content },
    // The snapshot is stamped with when its content was *saved* (the head's
    // updatedAt), not when this edit displaced it.
    snapshot: { title: head.title, content: head.content, createdAt: head.updatedAt as Date },
  })) as Promise<NoteRow | null>;

/**
 * Restores a past version into the head. Always records a snapshot of the
 * current head first (so the restore is itself reversible) and bypasses the
 * compression window. The restored version row is left in place — restore is
 * "edit head to match vN", not "move vN to head".
 */
export const restoreNoteVersion = (id: string, versionId: string) =>
  noteTier.restoreVersion(
    id,
    versionId,
    (version) => ({ title: version.title, content: version.content }),
    (head) => ({ title: head.title, content: head.content }),
  ) as Promise<NoteRow | null>;
