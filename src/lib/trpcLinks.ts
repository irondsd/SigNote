import { type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';

import type { AppRouter } from '@/server/routers/_app';
import { handleUnauthorized } from './authRedirect';
import { boundGenerationUser, generationConflictOf, readMarker } from './encryptionGeneration';
import { syncGeneration } from './encryptionGenerationClient';

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

/**
 * Turns a refused generation into either a retry or a reconciliation.
 *
 * The server answers `GENERATION_MISMATCH` for two very different situations,
 * and the difference is entirely local. A device that has never recorded a
 * marker simply does not know the number yet — it has no old-generation cache,
 * no stale key, nothing to throw away — so it learns the value and repeats the
 * call. A device that *did* record generation N and is told the account is at
 * N+1 has just discovered that a rotation committed underneath it: its query
 * cache, its MEK, its Auth key and its decrypted blobs all belong to a vault
 * that no longer exists.
 *
 * That second case is never retried. Replaying a mutation under the new
 * generation would push ciphertext sealed with the old MEK into the new vault,
 * which the fence exists to prevent; and replaying a query would only fetch
 * rows this device cannot decrypt. The observation is recorded and broadcast
 * instead, and the reconciliation listener (`EncryptionGenerationProvider`)
 * purges before anything renders. The original error still reaches the caller.
 */
export const generationLink: TRPCLink<AppRouter> = () => {
  return ({ op, next }) =>
    observable((observer) => {
      let attempted = false;
      let active: { unsubscribe: () => void } | null = null;

      const run = () => {
        active = next(op).subscribe({
          next: (value) => observer.next(value),
          complete: () => observer.complete(),
          error: (err) => {
            const conflict = generationConflictOf(err);
            const userId = boundGenerationUser();
            if (conflict !== 'GENERATION_MISMATCH' || attempted || !userId) {
              observer.error(err);
              return;
            }
            attempted = true;
            const known = readMarker(userId) !== null;
            void syncGeneration(userId).then((result) => {
              // Only a device that had nothing to invalidate may repeat the
              // call. Anything else hands the error back and lets the app
              // reconcile first.
              if (!known && result?.outcome === 'adopted') run();
              else observer.error(err);
            });
          },
        });
      };

      run();
      return () => active?.unsubscribe();
    });
};
