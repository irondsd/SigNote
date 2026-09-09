import { initTRPC, TRPCError } from '@trpc/server';

import { RouteAuthError, authenticateRequest } from '@/lib/routeAuth';
import type { Context } from './context';

/**
 * An error whose `cause` carries one of these gets its payload attached to the
 * wire error under `data.conflict`. It exists so a compare-and-set conflict can
 * stay a real CONFLICT — 409, thrown, impossible to mistake for success — while
 * still handing the caller the row as it actually is, which is what it needs to
 * re-apply or discard its edit.
 */
export type ConflictCause = { conflictData: unknown };

function hasConflictData(cause: unknown): cause is ConflictCause {
  return typeof cause === 'object' && cause !== null && 'conflictData' in cause;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    if (!hasConflictData(error.cause)) return shape;
    return { ...shape, data: { ...shape.data, conflict: error.cause.conflictData } };
  },
});

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
  let sid: string;
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
