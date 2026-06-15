import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertOwner } from '@/server/ownership';
import { objectId } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';

type Ownable = { userId: string };
type WithVersions = { userId: string; versions?: unknown[] };

/**
 * Builds the `versions` sub-router for a note tier. `relink` re-attaches any
 * files referenced by a restored version: notes parse them out of the
 * (plaintext) restored content; secrets/seals receive client-decrypted ids in
 * the input (`fileIds`).
 */
export function makeVersionsRouter<R>(opts: {
  getById: (id: string) => Promise<Ownable | null>;
  getVersions: (id: string) => Promise<WithVersions | null>;
  deleteVersion: (id: string, versionId: string) => Promise<unknown | null>;
  restoreVersion: (id: string, versionId: string) => Promise<R | null>;
  relink: (userId: string, id: string, updated: R, fileIds?: string[]) => Promise<void>;
}) {
  return router({
    // Full embedded history (oldest → newest) — the only endpoint that ships it.
    list: protectedProcedure.input(z.object({ id: objectId })).query(async ({ ctx, input }) => {
      const doc = assertOwner(await opts.getVersions(input.id), ctx.userId);
      return doc.versions ?? [];
    }),

    // Idempotent single-version delete.
    delete: protectedProcedure
      .input(z.object({ id: objectId, versionId: objectId }))
      .mutation(async ({ ctx, input }) => {
        assertOwner(await opts.getById(input.id), ctx.userId);
        const updated = await opts.deleteVersion(input.id, input.versionId);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
        return { success: true as const };
      }),

    restore: protectedProcedure
      .input(z.object({ id: objectId, versionId: objectId, fileIds: z.array(objectId).optional() }))
      .mutation(async ({ ctx, input }) => {
        assertOwner(await opts.getById(input.id), ctx.userId);
        const updated = await opts.restoreVersion(input.id, input.versionId);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });
        await opts.relink(ctx.userId, input.id, updated, input.fileIds);
        return updated;
      }),
  });
}
