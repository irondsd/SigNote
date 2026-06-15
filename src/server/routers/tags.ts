import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TAG_COLORS, type TagColor } from '@/config/noteStyles';
import {
  createTag,
  deleteTagAndDetach,
  getTagById,
  getTagUsageCounts,
  isDuplicateKeyError,
  listTags,
  normalizeTagName,
  tagNameTaken,
  updateTag,
} from '@/controllers/tags';
import { assertOwner } from '@/server/ownership';
import { objectId } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';

const tagColor = z.enum(TAG_COLORS);

export const tagsRouter = router({
  // GET /api/tags → { tags, counts }
  list: protectedProcedure.query(async ({ ctx }) => {
    const [tags, counts] = await Promise.all([listTags(ctx.userId), getTagUsageCounts(ctx.userId)]);
    return { tags, counts };
  }),

  // POST /api/tags
  create: protectedProcedure
    .input(z.object({ name: z.string(), color: tagColor.nullish() }))
    .mutation(async ({ ctx, input }) => {
      if (!normalizeTagName(input.name)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tag name is required' });
      }
      return createTag(ctx.userId, input.name, input.color);
    }),

  // PATCH /api/tags/[id]
  update: protectedProcedure
    .input(
      z.object({
        id: objectId,
        name: z.string().optional(),
        color: tagColor.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertOwner(await getTagById(input.id), ctx.userId);

      const patch: { name?: string; color?: TagColor } = {};

      if (input.name !== undefined) {
        const normalized = normalizeTagName(input.name);
        if (!normalized) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tag name is required' });
        if (await tagNameTaken(ctx.userId, normalized, input.id)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A tag with that name already exists' });
        }
        patch.name = normalized;
      }

      if (input.color !== undefined) {
        patch.color = input.color as TagColor;
      }

      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
      }

      try {
        return await updateTag(input.id, patch);
      } catch (err) {
        // A concurrent rename can win the uniqueness race after the tagNameTaken check.
        if (isDuplicateKeyError(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A tag with that name already exists' });
        }
        throw err;
      }
    }),

  // DELETE /api/tags/[id]
  delete: protectedProcedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => {
    assertOwner(await getTagById(input.id), ctx.userId);
    await deleteTagAndDetach(input.id);
    return { success: true as const };
  }),
});
