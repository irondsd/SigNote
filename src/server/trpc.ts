import { initTRPC, TRPCError } from '@trpc/server';

import { withRequestGeneration, VaultConflictError } from '@/db/encryptionState';
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

function toVaultTRPCError(err: VaultConflictError): TRPCError {
  const code = err.code === 'INVALID_GENERATION' ? 'BAD_REQUEST' : 'CONFLICT';
  return new TRPCError({ code, message: err.code, cause: err });
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
  // The generation is transport metadata rather than procedure input, so it
  // applies uniformly to every authenticated query/mutation.  Controllers
  // consume the request-scoped value while taking their account lock.
  try {
    const result = await withRequestGeneration(ctx.req.headers.get('x-signote-encryption-generation'), () =>
      next({ ctx: { ...ctx, userId, sid } }),
    );
    // tRPC catches resolver errors inside `next()` and returns them as a
    // MiddlewareResult. A VaultConflictError thrown by withVaultWrite therefore
    // never reaches this middleware's catch block; inspect the wrapped cause
    // and preserve the conflict as a real HTTP 409.
    if (!result.ok && result.error.cause instanceof VaultConflictError) {
      return { ...result, error: toVaultTRPCError(result.error.cause) };
    }
    return result;
  } catch (err) {
    if (err instanceof VaultConflictError) throw toVaultTRPCError(err);
    throw err;
  }
});

/**
 * Procedure for any authenticated caller. Adds `userId` / `sid` to ctx and
 * re-throws `RouteAuthError` as the matching `TRPCError`.
 */
export const protectedProcedure = publicProcedure.use(authMiddleware);
