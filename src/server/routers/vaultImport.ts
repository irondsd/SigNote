import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { vaultImportAnalysisSchema, vaultImportPlanSchema } from '@/lib/vaultBackup/importSchemas';
import { protectedProcedure, router } from '@/server/trpc';
import { getVaultImportService } from '@/server/vaultImport/instance';
import { VaultImportError } from '@/server/vaultImport/service';

const operation = z.object({ operationId: z.uuid() }).strict();

function fail(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof VaultImportError) {
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'EXPIRED'
          ? 'TIMEOUT'
          : error.code === 'INVALID_ARCHIVE'
            ? 'BAD_REQUEST'
            : error.code === 'LIMIT'
              ? 'PAYLOAD_TOO_LARGE'
              : 'CONFLICT';
    throw new TRPCError({ code, message: error.code });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'VAULT_IMPORT_FAILED' });
}

async function run<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    return fail(error);
  }
}

export const vaultImportRouter = router({
  analyze: protectedProcedure
    .input(vaultImportAnalysisSchema)
    .mutation(({ ctx, input }) =>
      run(() => getVaultImportService().analyze({ userId: ctx.userId, sid: ctx.sid }, input)),
    ),
  begin: protectedProcedure
    .input(operation.extend({ plan: vaultImportPlanSchema }).strict())
    .mutation(({ ctx, input }) =>
      run(() => getVaultImportService().begin({ userId: ctx.userId, sid: ctx.sid }, input.operationId, input.plan)),
    ),
  status: protectedProcedure
    .input(operation)
    .query(({ ctx, input }) =>
      run(() => getVaultImportService().status({ userId: ctx.userId, sid: ctx.sid }, input.operationId)),
    ),
  commit: protectedProcedure
    .input(operation)
    .mutation(({ ctx, input }) =>
      run(() => getVaultImportService().commit({ userId: ctx.userId, sid: ctx.sid }, input.operationId)),
    ),
  discardUnfinished: protectedProcedure.mutation(({ ctx }) =>
    run(() => getVaultImportService().discardUnfinished({ userId: ctx.userId, sid: ctx.sid })),
  ),
  cancel: protectedProcedure
    .input(operation)
    .mutation(({ ctx, input }) =>
      run(() => getVaultImportService().cancel({ userId: ctx.userId, sid: ctx.sid }, input.operationId)),
    ),
});
