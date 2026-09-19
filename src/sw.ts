import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, type RouteHandlerCallback } from 'serwist';

declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * tRPC procedures whose responses are bound to one encryption generation, or
 * that decide which generation the app believes it is on. `encryption.material`
 * is listed separately below because it is sensitive for a second reason.
 *
 * `secrets.`/`seals.` also cover their `versions` sub-routers, which travel as
 * `secrets.versions.list`. The plaintext `notes.` tier is deliberately absent:
 * its rows hold no ciphertext, so a stale cached page is merely out of date
 * rather than undecryptable, and offline reading of Notes is worth keeping.
 */
const ROTATION_SENSITIVE_PROCEDURES = ['rotation.', 'encryption.', 'secrets.', 'seals.', 'otp.'];

type VaultDownload = {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  port: MessagePort;
  expires: ReturnType<typeof setTimeout>;
  claimed: boolean;
  cancel?: (reason: unknown) => Promise<void>;
};
const vaultDownloads = new Map<string, VaultDownload>();
const VAULT_DOWNLOAD_PATH = '/__signote/vault-download/';
const VAULT_DOWNLOAD_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeDownloadName = (value: unknown) =>
  typeof value === 'string' && /^signote-vault-[0-9]{4}-[0-9]{2}-[0-9]{2}\.snvault$/.test(value)
    ? value
    : 'signote-vault.snvault';

const vaultDownloadHandler: RouteHandlerCallback = async ({ url }) => {
  const token = url.pathname.slice(VAULT_DOWNLOAD_PATH.length);
  const download = vaultDownloads.get(token);
  if (!download || download.claimed) return new Response('Download unavailable', { status: 404 });
  download.claimed = true;
  clearTimeout(download.expires);
  let bytesWritten = 0;
  const reader = download.stream.getReader();
  let settled = false;
  const notify = (message: { type: string; bytesWritten?: number }) => {
    if (settled) return;
    settled = true;
    vaultDownloads.delete(token);
    download.port.postMessage(message);
    download.port.close();
  };
  download.cancel = async (reason) => {
    await reader.cancel(reason).catch(() => undefined);
    notify({ type: 'error' });
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          notify({ type: 'complete', bytesWritten });
        } else {
          bytesWritten += value.byteLength;
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        notify({ type: 'error' });
      }
    },
    async cancel(reason) {
      await download.cancel?.(reason);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/vnd.signote.vault',
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin &&
        url.pathname.startsWith(VAULT_DOWNLOAD_PATH) &&
        VAULT_DOWNLOAD_TOKEN.test(url.pathname.slice(VAULT_DOWNLOAD_PATH.length)),
      handler: vaultDownloadHandler,
    },
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
    //
    // Everything below is claimed before `defaultCache` gets a chance at it.
    //
    // Key rotation makes a stale body worse than a missing one. A cached list
    // page or file body from the superseded generation cannot be decrypted with
    // the key the app now holds, and a cached `encryption.profile` would report
    // the wrong generation — which is the one value every other request is
    // checked against. None of these are offline features either: the
    // deliberate offline paths are the explicit stores (`otpStore`,
    // `encryptionMaterialStore`, the persisted query cache), which are
    // generation-aware and clearable by name.
    //
    // Path matching is by substring for the same reason `encryption.material`
    // is: the ordinary clients batch, so a procedure travels in a comma-joined
    // path alongside whatever else was in flight. Anything sharing that request
    // loses its caching too, which is the safe direction to err in. The
    // rotation client itself never batches, but an *old* client's batch is
    // exactly the request that must not be served from cache after an update.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin &&
        url.pathname.startsWith('/api/trpc') &&
        ROTATION_SENSITIVE_PROCEDURES.some((name) => url.pathname.includes(name)),
      handler: new NetworkOnly(),
    },
    // Encrypted file bodies and the upload/delete routes. The offline behaviour
    // of `/api/files` changes here: an attachment opened while offline now
    // fails rather than being served from a cache that may predate a rotation.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/files'),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/vault-export'),
      handler: new NetworkOnly(),
    },
    // Signed storage transfers are cross-origin, so they must be claimed before
    // the generic cross-origin and image rules in `defaultCache`. A presigned
    // URL is single-use by design and its response carries `no-store`; caching
    // one would keep ciphertext in a cache nothing clears by name.
    {
      matcher: ({ url, sameOrigin }) =>
        !sameOrigin && (url.pathname.includes('/rotation/') || url.searchParams.has('X-Amz-Signature')),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();

/**
 * An updated worker inherits the caches the previous one wrote, and those were
 * filled under the old rules — before encrypted-tier and file responses were
 * claimed as NetworkOnly. Sweep them once on activation so an upgraded client
 * cannot serve a body its current rules would have refused to store.
 *
 * Entries are deleted individually rather than dropping whole caches: `apis`
 * also holds responses this app still wants offline. A failure here is not
 * fatal — the app's own generation reconciliation purges these caches again
 * when it detects an advancement.
 */
// The project's TypeScript `lib` does not include `webworker`, so the worker
// event surface is named explicitly here rather than pulled in globally.
type ExtendableEventLike = { waitUntil(promise: Promise<unknown>): void };
const workerScope = self as unknown as {
  addEventListener(type: 'activate', listener: (event: ExtendableEventLike) => void): void;
};

workerScope.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          let pathname: string;
          try {
            ({ pathname } = new URL(request.url));
          } catch {
            continue;
          }
          const stale =
            new URL(request.url).searchParams.has('X-Amz-Signature') ||
            pathname.includes('/rotation/') ||
            pathname.startsWith('/api/files') ||
            pathname.startsWith('/api/vault-export') ||
            (pathname.startsWith('/api/trpc') &&
              ROTATION_SENSITIVE_PROCEDURES.some((procedure) => pathname.includes(procedure)));
          if (stale) await cache.delete(request);
        }
      }
    })().catch(() => undefined),
  );
});

// Only workers with generation-safe network rules acknowledge this protocol.
(
  self as unknown as {
    addEventListener(
      type: 'message',
      listener: (event: { data: { type?: string }; ports: MessagePort[] }) => void,
    ): void;
  }
).addEventListener('message', (event) => {
  if (event.data?.type === 'SIGNOTE_ROTATION_PROTOCOL') {
    event.ports[0]?.postMessage({ rotationProtocol: 1 });
    return;
  }
  if (event.data?.type === 'SIGNOTE_VAULT_DOWNLOAD_PROTOCOL') {
    event.ports[0]?.postMessage({ vaultDownloadProtocol: 1 });
    return;
  }
  if (event.data?.type !== 'SIGNOTE_VAULT_DOWNLOAD_REGISTER') return;
  const { token, stream } = event.data as { token?: unknown; stream?: unknown };
  const port = event.ports[0];
  if (
    typeof token !== 'string' ||
    !VAULT_DOWNLOAD_TOKEN.test(token) ||
    !(stream instanceof ReadableStream) ||
    !port ||
    vaultDownloads.has(token) ||
    vaultDownloads.size >= 4
  ) {
    port?.postMessage({ type: 'error' });
    port?.close();
    return;
  }
  const expires = setTimeout(() => {
    const pending = vaultDownloads.get(token);
    if (!pending) return;
    vaultDownloads.delete(token);
    void pending.stream.cancel('expired').catch(() => undefined);
    pending.port.postMessage({ type: 'expired' });
    pending.port.close();
  }, 120_000);
  vaultDownloads.set(token, {
    stream: stream as ReadableStream<Uint8Array>,
    filename: safeDownloadName((event.data as { filename?: unknown }).filename),
    port,
    expires,
    claimed: false,
  });
  port.postMessage({ type: 'registered' });
  port.addEventListener('message', (message) => {
    if (message.data?.type !== 'cancel') return;
    const pending = vaultDownloads.get(token);
    if (!pending) return;
    vaultDownloads.delete(token);
    clearTimeout(pending.expires);
    if (pending.cancel) void pending.cancel('cancelled');
    else void pending.stream.cancel('cancelled').catch(() => undefined);
    pending.port.close();
  });
  port.start();
});
