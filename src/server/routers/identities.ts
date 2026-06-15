import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getUserIdentities, LastIdentityError, unlinkIdentity } from '@/controllers/identities';
import { protectedProcedure, router } from '@/server/trpc';

export const identitiesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const identities = await getUserIdentities(ctx.userId);
    return identities.map((id) => ({
      provider: id.provider,
      providerSubject: id.providerSubject,
      email: 'email' in id ? (id.email as string | undefined) : undefined,
      lastLoginAt: id.lastLoginAt,
    }));
  }),

  unlink: protectedProcedure
    .input(z.object({ provider: z.enum(['google', 'siwe']) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const deleted = await unlinkIdentity(ctx.userId, input.provider);
        if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Identity not found' });
        return { ok: true as const };
      } catch (err) {
        if (err instanceof LastIdentityError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'LAST_IDENTITY' });
        }
        throw err;
      }
    }),
});
