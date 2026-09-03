import {
  noteTags,
  noteVersions,
  notes,
  sealNoteTags,
  sealNoteVersions,
  sealNotes,
  secretNoteTags,
  secretNoteVersions,
  secretNotes,
} from './schema';
import { makeTierRepo } from './tier';

/** The metadata columns every tier shares, in the shape `makeTierRepo` wants. */
const tierCols = (t: typeof notes | typeof secretNotes | typeof sealNotes) => ({
  id: t.id,
  userId: t.userId,
  title: t.title,
  position: t.position,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  deletedAt: t.deletedAt,
  archived: t.archived,
  color: t.color,
  pattern: t.pattern,
  pinned: t.pinned,
  expiresAt: t.expiresAt,
  burnAfterReading: t.burnAfterReading,
  searchTsv: t.searchTsv,
});

export const noteTier = makeTierRepo({
  table: notes,
  cols: tierCols(notes),
  // Tier 1 stores plaintext — the tsvector spans title (weight A) and content (B).
  contentKeys: ['content'],
  versions: {
    table: noteVersions,
    cols: {
      id: noteVersions.id,
      seq: noteVersions.seq,
      noteId: noteVersions.noteId,
      title: noteVersions.title,
      createdAt: noteVersions.createdAt,
    },
    contentKeys: ['content'],
  },
  join: {
    table: noteTags,
    cols: { noteId: noteTags.noteId, tagId: noteTags.tagId, sortOrder: noteTags.sortOrder },
  },
});

export const secretTier = makeTierRepo({
  table: secretNotes,
  cols: tierCols(secretNotes),
  // Body is ciphertext — the tsvector covers the plaintext title only.
  contentKeys: ['encryptedBody'],
  versions: {
    table: secretNoteVersions,
    cols: {
      id: secretNoteVersions.id,
      seq: secretNoteVersions.seq,
      noteId: secretNoteVersions.noteId,
      title: secretNoteVersions.title,
      createdAt: secretNoteVersions.createdAt,
    },
    contentKeys: ['encryptedBody'],
  },
  join: {
    table: secretNoteTags,
    cols: {
      noteId: secretNoteTags.noteId,
      tagId: secretNoteTags.tagId,
      sortOrder: secretNoteTags.sortOrder,
    },
  },
});

export const sealTier = makeTierRepo({
  table: sealNotes,
  cols: tierCols(sealNotes),
  contentKeys: ['encryptedBody', 'wrappedNoteKey'],
  versions: {
    table: sealNoteVersions,
    cols: {
      id: sealNoteVersions.id,
      seq: sealNoteVersions.seq,
      noteId: sealNoteVersions.noteId,
      title: sealNoteVersions.title,
      createdAt: sealNoteVersions.createdAt,
    },
    contentKeys: ['encryptedBody'],
  },
  join: {
    table: sealNoteTags,
    cols: {
      noteId: sealNoteTags.noteId,
      tagId: sealNoteTags.tagId,
      sortOrder: sealNoteTags.sortOrder,
    },
  },
});
