import { QueryClient, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 7 * 24 * 60 * 60 * 1000, // must be >= persister maxAge
        // The IndexedDB persister rehydrates the cache on load for instant
        // paint, but that snapshot can be a mutation behind the server (a note
        // deleted/recolored/expired in the previous session). Restore is async,
        // and when it wins the race against the initial fetch the rehydrated
        // data is <staleTime old and would otherwise suppress the refetch —
        // leaving stale cards on screen until staleTime elapses. Always
        // revalidate on mount so a reload reconciles with the server while
        // still showing the cached snapshot immediately.
        refetchOnMount: 'always',
        // Offline-first (PWA) guarantee: `refetchOnMount: 'always'` only fires
        // *when there's a connection*. With networkMode 'online' (TanStack's
        // default, pinned here so it can't silently change) an offline mount
        // PAUSES the fetch (fetchStatus: 'paused') instead of running it — the
        // rehydrated cache keeps rendering, so opening the app on a train shows
        // your notes, never an offline page. A failed refetch never clears the
        // existing data either; on reconnect refetchOnReconnect freshens it.
        networkMode: 'online',
      },
      dehydrate: {
        // include pending queries in dehydration
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}
