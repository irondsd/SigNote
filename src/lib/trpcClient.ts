import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@/server/routers/_app';
import { unauthorizedLink } from './trpcLinks';

/**
 * Vanilla (imperative) tRPC client for code paths that call procedures outside
 * React Query's hook integration — chiefly the note/secret/seal infinite-query
 * fetchers and their optimistic mutations, which keep their hand-tuned cache
 * layer (lib/queryCache.ts) and so can't use `trpc.*.useQuery`. Fully typed
 * against `AppRouter`.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [unauthorizedLink, httpBatchLink({ url: '/api/trpc' })],
});
