import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from 'serwist';

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
    // `encryption.material` carries `serverShare`, one half of the master key.
    // The generic `/api/` rule in `defaultCache` would take it as a side effect
    // of any fetch and keep it past sign-out, so it is claimed here first and
    // never written to disk. Keeping a copy is a decision the account makes
    // under Security, and `lib/encryptionMaterialStore.ts` is where an opted-in
    // device stores it — explicitly, and clearable by name.
    //
    // A substring test rather than an equality one: the client batches, so the
    // procedure travels in a comma-joined path alongside whatever else was in
    // flight. Anything sharing that request loses its caching too, which is the
    // safe direction to err in.
    {
      matcher: ({ url }) => url.pathname.includes('encryption.material'),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
