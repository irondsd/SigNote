import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { ExpirationPlugin, NetworkFirst, Serwist } from 'serwist';

declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Cache page navigations so offline refresh works on all routes (/secrets, /seals, etc.).
    // Without this, only statically precached pages (e.g. /) survive an offline refresh.
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'pages-cache',
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          }),
        ],
      }),
    },
    // Cache the session endpoint so the user stays authenticated offline.
    // NetworkFirst: serves fresh data when online, falls back to cache when offline.
    {
      matcher: ({ url }) => url.pathname === '/api/auth/session',
      handler: new NetworkFirst({
        cacheName: 'auth-session',
        // Do not serve a stale authenticated session merely because a cold
        // server took more than a few seconds to answer. The cached response is
        // still used when the network request actually fails (offline mode).
        plugins: [
          new ExpirationPlugin({
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days — matches session maxAge
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
