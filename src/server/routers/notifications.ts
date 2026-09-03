import { z } from 'zod';

import { getNotificationSettings, setNotificationPreferences } from '@/controllers/notifications';
import { protectedProcedure, router } from '@/server/trpc';

export const notificationsRouter = router({
  get: protectedProcedure.query(({ ctx }) => getNotificationSettings(ctx.userId)),

  /**
   * A partial patch, so a toggle sends only the switch that moved. There is
   * deliberately no key for sign-in codes: they aren't optional, and an API
   * that accepted the field would imply they are.
   */
  set: protectedProcedure
    .input(
      z
        .object({
          productNews: z.boolean().optional(),
          signInAlerts: z.boolean().optional(),
        })
        .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update'),
    )
    .mutation(({ ctx, input }) => setNotificationPreferences(ctx.userId, input)),
});
