import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getProfileData } from '@/controllers/profile';
import { updateDisplayName } from '@/controllers/users';
import { protectedProcedure, router } from '@/server/trpc';

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getProfileData(ctx.userId);
    if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    return profile;
  }),

  setDisplayName: protectedProcedure
    .input(
      z.object({
        displayName: z
          .string()
          .trim()
          .min(1, 'Display name cannot be empty')
          .max(50, 'Display name must be 50 characters or fewer'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await updateDisplayName(ctx.userId, input.displayName);
      return { ok: true as const };
    }),
});
