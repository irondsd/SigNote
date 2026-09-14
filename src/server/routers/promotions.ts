import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  cleanupPromotionUploads,
  prepareNotePromotion,
  prepareSecretPromotion,
  promoteNoteToSecret,
  promoteSecretToSeal,
  PromotionError,
} from '@/controllers/promotions';
import { MAX_VERSIONS } from '@/config/constants';
import { encryptedPayload, objectId } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';

const version = z.object({ id: objectId, encryptedBody: encryptedPayload.nullable() });

const mapPromotionError = (error: unknown): never => {
  if (!(error instanceof PromotionError)) throw error;
  const code = error.code === 'NOT_FOUND' ? 'NOT_FOUND' : error.code === 'CONFLICT' ? 'CONFLICT' : 'BAD_REQUEST';
  const message =
    error.code === 'BURN_ARMED'
      ? 'Cancel burn after reading before moving this item'
      : error.code === 'INVALID_FILES'
        ? 'Attachments changed while the item was being moved'
        : error.code === 'CONFLICT'
          ? 'The item changed while it was being moved'
          : 'Item not found';
  throw new TRPCError({ code, message, cause: error });
};

export const promotionsRouter = router({
  cleanupUploads: protectedProcedure
    .input(z.object({ ids: z.array(objectId).max(100) }))
    .mutation(({ ctx, input }) => cleanupPromotionUploads(ctx.userId, input.ids)),

  prepareNote: protectedProcedure.input(z.object({ id: objectId })).query(async ({ ctx, input }) => {
    try {
      return await prepareNotePromotion(ctx.userId, input.id);
    } catch (error) {
      return mapPromotionError(error);
    }
  }),

  prepareSecret: protectedProcedure.input(z.object({ id: objectId })).query(async ({ ctx, input }) => {
    try {
      return await prepareSecretPromotion(ctx.userId, input.id);
    } catch (error) {
      return mapPromotionError(error);
    }
  }),

  noteToSecret: protectedProcedure
    .input(
      z.object({
        id: objectId,
        expectedUpdatedAt: z.string().datetime(),
        encryptedBody: encryptedPayload.nullable(),
        versions: z.array(version).max(MAX_VERSIONS),
        fileReplacements: z.array(z.object({ sourceId: objectId, encryptedId: objectId })).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await promoteNoteToSecret(ctx.userId, input);
      } catch (error) {
        return mapPromotionError(error);
      }
    }),

  secretToSeal: protectedProcedure
    .input(
      z.object({
        id: objectId,
        expectedUpdatedAt: z.string().datetime(),
        encryptedBody: encryptedPayload.nullable(),
        wrappedNoteKey: encryptedPayload.nullable(),
        versions: z.array(version).max(MAX_VERSIONS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await promoteSecretToSeal(ctx.userId, input);
      } catch (error) {
        return mapPromotionError(error);
      }
    }),
});
