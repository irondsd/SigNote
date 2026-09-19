import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, router } from '@/server/trpc';
import { VaultConflictError } from '@/db/encryptionState';
import { vaultExportStartEnabled } from '@/server/vaultExport/enablement';
import {
  beginVaultExport,
  cancelVaultExport,
  finishVaultExport,
  getVaultExportAvailability,
  getVaultExportSummary,
  VaultExportError,
} from '@/server/vaultExport/service';

const operationSchema = z.object({ operationId: z.uuid() }).strict();
const selectionSchema = z
  .object({
    notes: z.boolean(),
    secrets: z.boolean(),
    seals: z.boolean(),
    authenticators: z.boolean(),
  })
  .strict();

export function toVaultExportTRPCError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof VaultConflictError) throw error;
  if (error instanceof VaultExportError) {
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'INVALID_SELECTION'
          ? 'BAD_REQUEST'
          : error.code === 'LIMIT'
            ? 'PAYLOAD_TOO_LARGE'
            : error.code === 'DISABLED'
              ? 'FORBIDDEN'
              : 'CONFLICT';
    throw new TRPCError({ code, message: error.code });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'VAULT_EXPORT_FAILED' });
}

async function execute<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    return toVaultExportTRPCError(error);
  }
}

export const vaultExportRouter = router({
  availability: protectedProcedure.query(({ ctx }) =>
    execute(() => getVaultExportAvailability(ctx.userId, vaultExportStartEnabled())),
  ),
  summary: protectedProcedure.query(({ ctx }) =>
    execute(() => getVaultExportSummary(ctx.userId, vaultExportStartEnabled())),
  ),
  begin: protectedProcedure.input(selectionSchema).mutation(({ ctx, input }) =>
    execute(() => {
      if (!vaultExportStartEnabled()) throw new VaultExportError('DISABLED');
      return beginVaultExport(ctx.userId, input);
    }),
  ),
  finish: protectedProcedure
    .input(operationSchema.extend({ manifestDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .mutation(({ ctx, input }) =>
      execute(() => finishVaultExport(ctx.userId, input.operationId, input.manifestDigest)),
    ),
  cancel: protectedProcedure
    .input(operationSchema)
    .mutation(({ ctx, input }) => execute(() => cancelVaultExport(ctx.userId, input.operationId))),
});
