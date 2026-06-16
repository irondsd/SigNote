'use client';

import dynamic from 'next/dynamic';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useSession } from 'next-auth/react';
// import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useState, type FC, type ReactNode } from 'react';

import { trpc } from '@/lib/trpc';
import { unauthorizedLink } from '@/lib/trpcLinks';
import { getQueryClient } from '@/utils/getQueryClient';

// ssr:false ensures QueryPersister and all its imports (idb-keyval, persist client)
// are never included in the server bundle or evaluated during SSR / static generation.
const QueryPersister = dynamic(() => import('./QueryPersister'), { ssr: false });

// tRPC query keys don't carry the userId, so the in-memory cache must be cleared
// on sign-out to prevent a subsequent user (same tab, no reload) from reading
// the previous user's cached data. The persisted IDB copy is dropped separately
// in AuthSessionProvider's SessionCleanup.
const QueryCacheGuard: FC = () => {
  const { status } = useSession();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (status === 'unauthenticated') queryClient.clear();
  }, [status, queryClient]);
  return null;
};

export const ReactQueryProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = getQueryClient();
  // Stable tRPC client for the lifetime of the provider. The 401 → sign-out
  // behavior currently lives in lib/api.ts (REST); a dedicated error link will
  // move here in Phase 2 once hooks call tRPC.
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [unauthorizedLink, httpBatchLink({ url: '/api/trpc' })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        <QueryPersister />
        <QueryCacheGuard />
        {/* <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" /> */}
      </QueryClientProvider>
    </trpc.Provider>
  );
};
