import { z } from 'zod';

import { getSecurityPreferences, setSecurityPreferences } from '@/controllers/securityPreferences';
import { protectedProcedure, router } from '@/server/trpc';

export const securityRouter = router({
  get: protectedProcedure.query(({ ctx }) => getSecurityPreferences(ctx.userId)),

  /** A partial patch, so a toggle sends only the switch that moved. */
  set: protectedProcedure
    .input(
      z
        .object({
          cacheServerShare: z.boolean().optional(),
          blurAuthCodes: z.boolean().optional(),
        })
        .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update'),
    )
    .mutation(({ ctx, input }) => setSecurityPreferences(ctx.userId, input)),
});
