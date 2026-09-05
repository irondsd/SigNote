import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@/server/routers/_app';
import { getSessionClientHeaders } from './sessionClient';

/**
 * The authenticator's own tRPC client — the same transport as `trpcClient` but
 * deliberately without `unauthorizedLink`.
 *
 * That link exists so a 401 anywhere else signs the user out: it toasts,
 * broadcasts a logout to every tab and navigates to `/`. On the authenticator
 * that is precisely the wrong behaviour. A stored code is often what the user
 * needs *in order to* sign in again, so an expired session must pause
 * synchronisation and nothing more (security invariant 7). Callers read the
 * UNAUTHORIZED code themselves and set `syncState = 'signed-out'`.
 */
export const otpTrpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc', headers: getSessionClientHeaders })],
});

/** True when a thrown tRPC error means "the session is gone", not "this failed". */
export function isUnauthorized(err: unknown): boolean {
  const data = (err as { data?: { code?: string } } | undefined)?.data;
  return data?.code === 'UNAUTHORIZED';
}

/** A compare-and-set conflict carries the current row under `data.conflict`. */
export function conflictRow<T>(err: unknown): T | null {
  const data = (err as { data?: { code?: string; conflict?: T } } | undefined)?.data;
  return data?.code === 'CONFLICT' ? (data.conflict ?? null) : null;
}
