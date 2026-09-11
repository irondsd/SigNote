import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@/server/routers/_app';
import { handleUnauthorized } from './authRedirect';
import { getSessionClientHeaders } from './sessionClient';
import { generationHeaders } from './encryptionGeneration';
import { generationLink } from './trpcLinks';

/**
 * The authenticator's own tRPC client — the same transport as `trpcClient` but
 * deliberately without `unauthorizedLink`.
 *
 * That link exists so a 401 anywhere else signs the user out: it toasts,
 * broadcasts a logout to every tab and navigates to `/`. On the authenticator
 * Keeping this separate lets the vault finish its own error handling before a
 * rejected session starts the shared sign-out and local-data cleanup flow.
 */
export const otpTrpcClient = createTRPCClient<AppRouter>({
  links: [
    generationLink,
    httpBatchLink({
      url: '/api/trpc',
      headers: () => ({ ...getSessionClientHeaders(), ...generationHeaders() }),
    }),
  ],
});

/** True when a thrown tRPC error means "the session is gone", not "this failed". */
export function isUnauthorized(err: unknown): boolean {
  const data = (err as { data?: { code?: string } } | undefined)?.data;
  return data?.code === 'UNAUTHORIZED';
}

/** A rejected Authenticator request is a confirmed session termination. */
export async function handleOtpUnauthorized(err: unknown): Promise<boolean> {
  if (!isUnauthorized(err)) return false;
  await handleUnauthorized();
  return true;
}

/** A compare-and-set conflict carries the current row under `data.conflict`. */
export function conflictRow<T>(err: unknown): T | null {
  const data = (err as { data?: { code?: string; conflict?: T } } | undefined)?.data;
  return data?.code === 'CONFLICT' ? (data.conflict ?? null) : null;
}
