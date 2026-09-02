import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { listUserSessions, revokeAllOtherSessions, revokeSession } from '@/controllers/authSessions';
import { objectId } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';

export const sessionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await listUserSessions(ctx.userId);
    return {
      sessions: sessions.map((s) => ({
        _id: s._id.toString(),
        provider: s.provider,
        client: s.client ?? 'web',
        ip: s.ip,
        browser: s.browser,
        os: s.os,
        deviceType: s.deviceType,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        expiresAt: s.expiresAt,
        current: ctx.sid !== null && s._id.toString() === ctx.sid,
      })),
    };
  }),

  // Revoke a single session by id.
  revoke: protectedProcedure.input(z.object({ id: objectId })).mutation(async ({ ctx, input }) => {
    const ok = await revokeSession(input.id, ctx.userId);
    if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
    return { revoked: true as const, wasCurrent: input.id === ctx.sid };
  }),

  // Revoke every other session (old DELETE /api/sessions).
  revokeOthers: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.sid) {
      // Legacy JWT with no session id — refuse rather than risk revoking self.
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot revoke from a legacy session. Sign out and back in first.',
      });
    }
    const revoked = await revokeAllOtherSessions(ctx.userId, ctx.sid);
    return { revoked };
  }),
});
