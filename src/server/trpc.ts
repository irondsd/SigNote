import { initTRPC, TRPCError } from '@trpc/server';

import { RouteAuthError, authenticateRequest } from '@/lib/routeAuth';
import type { Context } from './context';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Maps the REST-layer `RouteAuthError` (status + message) onto a `TRPCError` so
 * both transports surface the same auth semantics.
 */
function toTRPCError(err: RouteAuthError): TRPCError {
  const code = err.status === 401 ? 'UNAUTHORIZED' : err.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND';
  return new TRPCError({ code, message: err.message });
}

const authMiddleware = t.middleware(async ({ ctx, next }) => {
  let userId: string;
  let sid: string | null;
  try {
    ({ userId, sid } = await authenticateRequest(ctx.req));
  } catch (err) {
    if (err instanceof RouteAuthError) throw toTRPCError(err);
    throw err;
  }
  return next({ ctx: { ...ctx, userId, sid } });
});

/**
 * Procedure for any authenticated caller. Adds `userId` / `sid` to ctx and
 * re-throws `RouteAuthError` as the matching `TRPCError`.
 */
export const protectedProcedure = publicProcedure.use(authMiddleware);
