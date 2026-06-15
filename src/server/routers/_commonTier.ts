import { z } from 'zod';

import { restoreFilesByNoteId, softDeleteFilesByNoteId } from '@/controllers/files';
import { getOwnedTagIds, touchTags } from '@/controllers/tags';
import { assertOwner } from '@/server/ownership';
import { noteColor, notePattern, objectId, tagIdList } from '@/server/schemas/common';
import { protectedProcedure } from '@/server/trpc';
import { metaInput, resolveMetaUpdate } from './_meta';

type Ownable = { userId: string };

/** The slice of `commonOps` (controllers/common.ts) these procedures drive. */
export interface CommonOps {
  softDelete: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  archive: (id: string) => Promise<unknown>;
  unarchive: (id: string) => Promise<unknown>;
  updateColor: (id: string, color: string | null) => Promise<unknown>;
  updatePattern: (id: string, pattern: string | null) => Promise<unknown>;
  updatePosition: (id: string, position: number) => Promise<unknown>;
  updateTags: (id: string, tags: string[]) => Promise<unknown>;
  applyPatch: (
    id: string,
    update: { pinned?: boolean; expiresAt?: Date | null; burnAfterReading?: boolean },
  ) => Promise<unknown>;
}

/**
 * The operations shared by all three note tiers, decomposed from the old
 * polymorphic PATCH into discrete, individually-typed procedures. Spread the
 * result into each tier router. `getById` supplies the ownership check.
 */
export function commonTierProcedures<T extends Ownable>(getById: (id: string) => Promise<T | null>, ops: CommonOps) {
  const own = async (id: string, userId: string) => assertOwner(await getById(id), userId);

  return {
    // Soft-delete (trash). Matches the old DELETE route: also soft-deletes
    // attachments. Returns success rather than the doc.
    delete: protectedProcedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => {
      await own(input.id, ctx.userId);
      await ops.softDelete(input.id);
      await softDeleteFilesByNoteId(input.id);
      return { success: true as const };
    }),

    // Restore from trash (old PATCH { deleted: false }). Re-attaches files.
    restore: protectedProcedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => {
      await own(input.id, ctx.userId);
      const updated = await ops.restore(input.id);
      await restoreFilesByNoteId(input.id, ctx.userId);
      return updated;
    }),

    setArchived: protectedProcedure
      .input(z.object({ id: objectId, archived: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await own(input.id, ctx.userId);
        return input.archived ? ops.archive(input.id) : ops.unarchive(input.id);
      }),

    setColor: protectedProcedure
      .input(z.object({ id: objectId, color: noteColor }))
      .mutation(async ({ ctx, input }) => {
        await own(input.id, ctx.userId);
        return ops.updateColor(input.id, input.color);
      }),

    setPattern: protectedProcedure
      .input(z.object({ id: objectId, pattern: notePattern }))
      .mutation(async ({ ctx, input }) => {
        await own(input.id, ctx.userId);
        return ops.updatePattern(input.id, input.pattern);
      }),

    setPosition: protectedProcedure
      .input(z.object({ id: objectId, position: z.number().finite() }))
      .mutation(async ({ ctx, input }) => {
        await own(input.id, ctx.userId);
        return ops.updatePosition(input.id, input.position);
      }),

    setTags: protectedProcedure.input(z.object({ id: objectId, tags: tagIdList })).mutation(async ({ ctx, input }) => {
      await own(input.id, ctx.userId);
      // Drop ids the user doesn't own (foreign / deleted) before persisting.
      const ownedTagIds = await getOwnedTagIds(ctx.userId, input.tags);
      const updated = await ops.updateTags(input.id, ownedTagIds);
      await touchTags(ownedTagIds);
      return updated;
    }),

    // Pin / expiry / burn in one call. Mutex (preserved from handleCommonPatch):
    // turning burnAfterReading on clears expiresAt and vice versa, EXCEPT when
    // both fields are sent explicitly (the arming path), where the caller wins.
    setMeta: protectedProcedure.input(metaInput).mutation(async ({ ctx, input }) => {
      await own(input.id, ctx.userId);
      return ops.applyPatch(input.id, resolveMetaUpdate(input));
    }),
  };
}
