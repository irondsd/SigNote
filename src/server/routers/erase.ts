import { z } from 'zod';

import {
  eraseAccount,
  eraseEncryptionProfile,
  eraseFiles,
  eraseNotes,
  eraseSeals,
  eraseSecrets,
} from '@/controllers/erase';
import { ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE, assertEraseToken, issueEraseToken } from '@/lib/eraseAuth';
import { protectedProcedure, router } from '@/server/trpc';

const tokenInput = z.object({ token: z.string() });

const ALL = [ERASE_ALL_SCOPE] as const;
const ALL_OR_ENC = [ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE] as const;

export const eraseRouter = router({
  // Step 1: issue a scoped token (old POST /api/erase/verify and
  // /api/erase-encryption/verify).
  verifyAll: protectedProcedure.mutation(({ ctx }) => ({ token: issueEraseToken(ctx.userId, ERASE_ALL_SCOPE) })),
  verifyEncryption: protectedProcedure.mutation(({ ctx }) => ({
    token: issueEraseToken(ctx.userId, ERASE_ENCRYPTION_SCOPE),
  })),

  // Step 2: destructive operations, each gated on the replayed token.
  account: protectedProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    assertEraseToken(input.token, ctx.userId, ALL);
    await eraseFiles(ctx.userId);
    await eraseAccount(ctx.userId);
    return { ok: true as const };
  }),

  notes: protectedProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    assertEraseToken(input.token, ctx.userId, ALL);
    await eraseNotes(ctx.userId);
    return { ok: true as const };
  }),

  seals: protectedProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    assertEraseToken(input.token, ctx.userId, ALL_OR_ENC);
    await eraseSeals(ctx.userId);
    return { ok: true as const };
  }),

  secrets: protectedProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    assertEraseToken(input.token, ctx.userId, ALL_OR_ENC);
    await eraseSecrets(ctx.userId);
    return { ok: true as const };
  }),

  encryption: protectedProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    assertEraseToken(input.token, ctx.userId, ALL_OR_ENC);
    await eraseEncryptionProfile(ctx.userId);
    return { ok: true as const };
  }),
});
