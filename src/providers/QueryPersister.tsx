'use client';

// This file is loaded only on the client via next/dynamic ssr:false.
// All IDB and persistence imports are safe here — they never run on the server.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { queryCacheStorage } from '@/lib/idb';

const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days — matches session maxAge

export default function QueryPersister() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const persister = createAsyncStoragePersister({
      storage: queryCacheStorage,
      key: 'signote-query-cache',
      throttleTime: 1000,
    });

    const [unsubscribe, restoredPromise] = persistQueryClient({
      queryClient,
      persister,
      maxAge: MAX_AGE,
      buster: process.env.NEXT_PUBLIC_APP_VERSION ?? '',
      // NOTE Phase 3: if a TanStack Query key for encryption material is added,
      // add a shouldDehydrateQuery filter here to exclude it from IDB.
    });

    // Suppress unhandled rejection if restore fails (e.g. IDB blocked by browser)
    restoredPromise.catch(() => {});

    return unsubscribe;
  }, [queryClient]);

  return null;
}
