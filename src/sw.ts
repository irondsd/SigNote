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
    // Cache the session endpoint so the user stays authenticated offline.
    // NetworkFirst: serves fresh data when online, falls back to cache when offline.
    {
      matcher: ({ url }) => url.pathname === '/api/auth/session',
      handler: new NetworkFirst({
        cacheName: 'auth-session',
        networkTimeoutSeconds: 3,
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
