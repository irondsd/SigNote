import { type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';

import type { AppRouter } from '@/server/routers/_app';
import { handleUnauthorized } from './authRedirect';

/**
 * Fires the shared sign-out flow whenever any tRPC call returns UNAUTHORIZED —
 * the transport-agnostic equivalent of the ky `afterResponse` 401 hook. Used by
 * both the vanilla client and the React Query client.
 */
export const unauthorizedLink: TRPCLink<AppRouter> = () => {
  return ({ op, next }) =>
    observable((observer) => {
      const subscription = next(op).subscribe({
        next: (value) => observer.next(value),
        complete: () => observer.complete(),
        error: (err) => {
          if (err.data?.code === 'UNAUTHORIZED') void handleUnauthorized();
          observer.error(err);
        },
      });
      return subscription;
    });
};
