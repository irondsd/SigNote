import { z } from 'zod';

import { MAX_TITLE } from '@/config/constants';
import { linkFilesToNote } from '@/controllers/files';
import {
  createSeal,
  deleteSealVersion,
  getSealById,
  getSealsByUserId,
  getSealVersions,
  restoreSealVersion,
  sealOps,
  updateSeal,
} from '@/controllers/seals';
import { getOwnedTagIds, touchTags } from '@/controllers/tags';
import { assertOwner } from '@/server/ownership';
import { encryptedPayload, listParams, noteColor, notePattern, objectId, tagIdList } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';
import { commonTierProcedures } from './_commonTier';
import { makeVersionsRouter } from './_versions';

export const sealsRouter = router({
  list: protectedProcedure
    .input(listParams)
    .query(({ ctx, input }) =>
      getSealsByUserId(ctx.userId, input.archived, input.limit, input.offset, input.search, input.tags, input.tagMode),
    ),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().max(MAX_TITLE).optional(),
        encryptedBody: encryptedPayload.nullish(),
        wrappedNoteKey: encryptedPayload.nullish(),
        color: noteColor.optional(),
        pattern: notePattern.optional(),
        fileIds: z.array(objectId).optional(),
        tags: tagIdList.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tagIds = input.tags ? await getOwnedTagIds(ctx.userId, input.tags) : undefined;
      // encryptedBody and wrappedNoteKey are optional for the 2-step create flow.
      const seal = await createSeal(
        ctx.userId,
        input.title ?? '',
        input.encryptedBody ?? null,
        input.wrappedNoteKey ?? null,
        input.color,
        input.pattern,
        tagIds,
      );
      if (tagIds?.length) await touchTags(tagIds);

      if (input.fileIds?.length) await linkFilesToNote(ctx.userId, seal._id.toString(), 'seal', input.fileIds);

      return seal;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: objectId,
        title: z.string().max(MAX_TITLE).optional(),
        encryptedBody: encryptedPayload.nullish(),
        wrappedNoteKey: encryptedPayload.nullish(),
        fileIds: z.array(objectId).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const seal = assertOwner(await getSealById(input.id), ctx.userId);
      const updated = await updateSeal(input.id, {
        title: input.title !== undefined ? input.title : seal.title,
        encryptedBody: input.encryptedBody !== undefined ? input.encryptedBody : seal.encryptedBody,
        wrappedNoteKey: input.wrappedNoteKey !== undefined ? input.wrappedNoteKey : seal.wrappedNoteKey,
      });
      if (input.fileIds?.length) await linkFilesToNote(ctx.userId, input.id, 'seal', input.fileIds);
      return updated;
    }),

  ...commonTierProcedures(getSealById, sealOps),

  versions: makeVersionsRouter({
    getById: getSealById,
    getVersions: getSealVersions,
    deleteVersion: deleteSealVersion,
    restoreVersion: restoreSealVersion,
    // Encrypted body: the client decrypts the version and reports its file ids.
    relink: async (userId, id, _updated, fileIds) => {
      if (fileIds?.length) await linkFilesToNote(userId, id, 'seal', fileIds);
    },
  }),
});
