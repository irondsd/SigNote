'use client';

import dynamic from 'next/dynamic';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { FC, ReactNode } from 'react';

import { getQueryClient } from '@/utils/getQueryClient';

// ssr:false ensures QueryPersister and all its imports (idb-keyval, persist client)
// are never included in the server bundle or evaluated during SSR / static generation.
const QueryPersister = dynamic(() => import('./QueryPersister'), { ssr: false });

export const ReactQueryProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <QueryPersister />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};
