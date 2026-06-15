import { z } from 'zod';

import { MAX_CONTENT, MAX_TITLE } from '@/config/constants';
import { linkFilesToNote } from '@/controllers/files';
import {
  createNote,
  deleteNoteVersion,
  getNoteById,
  getNotesByUserId,
  getNoteVersions,
  noteOps,
  restoreNoteVersion,
  updateNote,
} from '@/controllers/notes';
import { getOwnedTagIds, touchTags } from '@/controllers/tags';
import { extractFileIds } from '@/lib/fileIds';
import { assertOwner } from '@/server/ownership';
import { listParams, noteColor, notePattern, objectId, tagIdList } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';
import { commonTierProcedures } from './_commonTier';
import { makeVersionsRouter } from './_versions';

export const notesRouter = router({
  list: protectedProcedure
    .input(listParams)
    .query(({ ctx, input }) =>
      getNotesByUserId(ctx.userId, input.archived, input.limit, input.offset, input.search, input.tags, input.tagMode),
    ),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().max(MAX_TITLE).optional(),
        content: z.string().max(MAX_CONTENT).optional(),
        color: noteColor.optional(),
        pattern: notePattern.optional(),
        tags: tagIdList.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tagIds = input.tags ? await getOwnedTagIds(ctx.userId, input.tags) : undefined;
      const note = await createNote(
        ctx.userId,
        input.title ?? '',
        input.content ?? '',
        input.color,
        input.pattern,
        tagIds,
      );
      if (tagIds?.length) await touchTags(tagIds);

      const fileIds = extractFileIds(input.content ?? '');
      if (fileIds.length) await linkFilesToNote(ctx.userId, note._id.toString(), 'note', fileIds);

      return note;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: objectId,
        title: z.string().max(MAX_TITLE).optional(),
        content: z.string().max(MAX_CONTENT).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const note = assertOwner(await getNoteById(input.id), ctx.userId);
      const updated = await updateNote(input.id, input.title ?? note.title, input.content ?? note.content);
      if (input.content !== undefined) {
        const fileIds = extractFileIds(input.content);
        if (fileIds.length) await linkFilesToNote(ctx.userId, input.id, 'note', fileIds);
      }
      return updated;
    }),

  ...commonTierProcedures(getNoteById, noteOps),

  versions: makeVersionsRouter({
    getById: getNoteById,
    getVersions: getNoteVersions,
    deleteVersion: deleteNoteVersion,
    restoreVersion: restoreNoteVersion,
    // Notes store plaintext: parse file ids straight out of the restored content.
    relink: async (userId, id, updated: Awaited<ReturnType<typeof restoreNoteVersion>>) => {
      if (!updated) return;
      const fileIds = extractFileIds(updated.content);
      if (fileIds.length) await linkFilesToNote(userId, id, 'note', fileIds);
    },
  }),
});
