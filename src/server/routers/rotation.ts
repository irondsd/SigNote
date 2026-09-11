import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from '@/server/trpc';
import { RotationError, beginSchema, itemRefSchema, payloadSchema, workerSchema } from '@/server/rotation/contracts';
import { RotationStorageError } from '@/server/rotation/objectStore';
import { getRotationService } from '@/server/rotation/instance';

async function execute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof RotationError) {
      const code =
        error.code === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'INVALID_INPUT'
            ? 'BAD_REQUEST'
            : error.code === 'LIMIT'
              ? 'PAYLOAD_TOO_LARGE'
              : 'CONFLICT';
      throw new TRPCError({ code, message: error.code });
    }
    if (error instanceof RotationStorageError)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.code });
    // Provider errors can contain request context; expose no signed URLs, keys,
    // filenames or payloads through RPC error serialization.
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'ROTATION_OPERATION_FAILED' });
  }
}
const reference = workerSchema.extend({ item: itemRefSchema });
export const rotationRouter = router({
  status: protectedProcedure
    .input(z.object({ operationId: z.uuid().optional() }).optional())
    .query(({ ctx, input }) => execute(() => getRotationService().status(ctx, input?.operationId))),
  begin: protectedProcedure
    .input(beginSchema)
    .mutation(({ ctx, input }) => execute(() => getRotationService().begin(ctx, input))),
  inventory: protectedProcedure
    .input(workerSchema.extend({ after: itemRefSchema.optional() }))
    .query(({ ctx, input }) => execute(() => getRotationService().inventory(ctx, input, input.after))),
  stage: protectedProcedure
    .input(reference.extend({ replacement: payloadSchema.nullable(), stageKey: z.string().min(1).max(128) }).strict())
    .mutation(({ ctx, input }) =>
      execute(() => getRotationService().stage(ctx, input, input.item, input.replacement, input.stageKey)),
    ),
  verify: protectedProcedure
    .input(reference.extend({ replacementDigest: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ ctx, input }) =>
      execute(() => getRotationService().verify(ctx, input, input.item, input.replacementDigest)),
    ),
  confirmRecovery: protectedProcedure
    .input(
      workerSchema.extend({
        recovery: z
          .object({
            profileId: z.string().min(1).max(128),
            generation: z.number().int().positive(),
            inventoryDigest: z.string().regex(/^[a-f0-9]{64}$/),
            acknowledged: z.literal(true),
          })
          .strict(),
      }),
    )
    .mutation(({ ctx, input }) => execute(() => getRotationService().confirmRecovery(ctx, input, input.recovery))),
  pause: protectedProcedure
    .input(workerSchema.extend({ paused: z.boolean() }))
    .mutation(({ ctx, input }) => execute(() => getRotationService().pause(ctx, input, input.paused))),
  claim: protectedProcedure
    .input(z.object({ operationId: z.uuid(), expectedWorkerFence: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      execute(() => getRotationService().claim(ctx, input.operationId, input.expectedWorkerFence)),
    ),
  cancel: protectedProcedure
    .input(workerSchema)
    .mutation(({ ctx, input }) => execute(() => getRotationService().cancel(ctx, input))),
  sourceFile: protectedProcedure
    .input(workerSchema.extend({ resourceId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => execute(() => getRotationService().sourceFile(ctx, input, input.resourceId))),
  reserveFile: protectedProcedure
    .input(
      workerSchema.extend({
        resourceId: z.string().min(1).max(128),
        file: z
          .object({
            bytes: z
              .number()
              .int()
              .min(16)
              .max(5 * 1024 * 1024),
            iv: z.string().length(16),
            checksum: z.string().length(44),
          })
          .strict(),
      }),
    )
    .mutation(({ ctx, input }) =>
      execute(() => getRotationService().reserveFile(ctx, input, input.resourceId, input.file)),
    ),
  finalizeFile: protectedProcedure
    .input(
      workerSchema.extend({
        resourceId: z.string().min(1).max(128),
        objectKey: z.string().max(128),
        stageKey: z.string().min(1).max(128),
      }),
    )
    .mutation(({ ctx, input }) =>
      execute(() => getRotationService().finalizeFile(ctx, input, input.resourceId, input.objectKey, input.stageKey)),
    ),
  stagedFile: protectedProcedure
    .input(workerSchema.extend({ resourceId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => execute(() => getRotationService().stagedFile(ctx, input, input.resourceId))),
  commit: protectedProcedure
    .input(workerSchema)
    .mutation(({ ctx, input }) => execute(() => getRotationService().commit(ctx, input))),
});
