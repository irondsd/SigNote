import { z } from 'zod';

import { MAX_TITLE } from '@/config/constants';
import { linkFilesToNote } from '@/controllers/files';
import {
  createSecret,
  deleteSecretVersion,
  getSecretById,
  getSecretsByUserId,
  getSecretVersions,
  restoreSecretVersion,
  secretOps,
  updateSecret,
} from '@/controllers/secrets';
import { getOwnedTagIds, touchTags } from '@/controllers/tags';
import { assertOwner } from '@/server/ownership';
import { encryptedPayload, listParams, noteColor, notePattern, objectId, tagIdList } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';
import { commonTierProcedures } from './_commonTier';
import { makeVersionsRouter } from './_versions';

export const secretsRouter = router({
  list: protectedProcedure
    .input(listParams)
    .query(({ ctx, input }) =>
      getSecretsByUserId(
        ctx.userId,
        input.archived,
        input.limit,
        input.offset,
        input.search,
        input.tags,
        input.tagMode,
      ),
    ),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().max(MAX_TITLE).optional(),
        encryptedBody: encryptedPayload.nullish(),
        color: noteColor.optional(),
        pattern: notePattern.optional(),
        fileIds: z.array(objectId).optional(),
        tags: tagIdList.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tagIds = input.tags ? await getOwnedTagIds(ctx.userId, input.tags) : undefined;
      const secret = await createSecret(
        ctx.userId,
        input.title ?? '',
        input.encryptedBody ?? null,
        input.color,
        input.pattern,
        tagIds,
      );
      if (tagIds?.length) await touchTags(tagIds);

      if (input.fileIds?.length) await linkFilesToNote(ctx.userId, secret._id.toString(), 'secret', input.fileIds);

      return secret;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: objectId,
        title: z.string().max(MAX_TITLE).optional(),
        encryptedBody: encryptedPayload.nullish(),
        fileIds: z.array(objectId).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const secret = assertOwner(await getSecretById(input.id), ctx.userId);
      const updated = await updateSecret(
        input.id,
        input.title ?? secret.title,
        input.encryptedBody !== undefined ? input.encryptedBody : secret.encryptedBody,
      );
      if (input.fileIds?.length) await linkFilesToNote(ctx.userId, input.id, 'secret', input.fileIds);
      return updated;
    }),

  ...commonTierProcedures(getSecretById, secretOps),

  versions: makeVersionsRouter({
    getById: getSecretById,
    getVersions: getSecretVersions,
    deleteVersion: deleteSecretVersion,
    restoreVersion: restoreSecretVersion,
    // Encrypted body: the client decrypts the version and reports its file ids.
    relink: async (userId, id, _updated, fileIds) => {
      if (fileIds?.length) await linkFilesToNote(userId, id, 'secret', fileIds);
    },
  }),
});
