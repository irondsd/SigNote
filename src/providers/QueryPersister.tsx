'use client';

// This file is loaded only on the client via next/dynamic ssr:false.
// All IDB and persistence imports are safe here — they never run on the server.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { confirmedQueryState } from '@/lib/confirmedQueryState';
import { queryCacheStorage } from '@/lib/idb';

const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days — matches session maxAge

export default function QueryPersister() {
  const queryClient = useQueryClient();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'loading') return;
    const persister = createAsyncStoragePersister({
      storage: queryCacheStorage,
      key: 'signote-query-cache',
      throttleTime: 1000,
    });

    const [unsubscribe, restoredPromise] = persistQueryClient({
      queryClient,
      persister: {
        ...persister,
        persistClient: (client) =>
          persister.persistClient({
            ...client,
            clientState: confirmedQueryState(queryClient, client.clientState),
          }),
      },
      maxAge: MAX_AGE,
      // A single browser can sign into accounts that legitimately own the same
      // portable ids. Never hydrate one account's snapshot into another.
      buster: `${process.env.NEXT_PUBLIC_APP_VERSION ?? ''}:${session?.user.id ?? 'signed-out'}`,
      dehydrateOptions: { shouldDehydrateMutation: () => false },
      // NOTE Phase 3: if a TanStack Query key for encryption material is added,
      // add a shouldDehydrateQuery filter here to exclude it from IDB.
    });

    // Suppress unhandled rejection if restore fails (e.g. IDB blocked by browser)
    restoredPromise.catch(() => {});

    return unsubscribe;
  }, [queryClient, session?.user.id, status]);

  return null;
}
