import { withPostHogConfig } from '@posthog/nextjs-config';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';
const posthogProjectId = process.env.POSTHOG_PROJECT_ID;
const posthogApiKey = process.env.POSTHOG_API_KEY;

const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: !isProduction,
});

/**
 * The object store the browser talks to directly.
 *
 * Key rotation transfers encrypted file bodies to presigned URLs from the page
 * itself, bypassing the app server's request-size limit. `connect-src https:`
 * already covers a real bucket, but a configured S3-compatible endpoint — R2,
 * MinIO, or the loopback mock the E2E suite runs — is a specific origin the
 * policy has to name, or every signed transfer is blocked before it is sent.
 *
 * Only the origin is added: the path, the signature and the bucket are not the
 * CSP's business, and naming a whole host is the narrowest thing this directive
 * can express.
 *
 * `headers()` is evaluated by `next build` and baked into the routes manifest,
 * so this resolves at BUILD time. `AWS_S3_ENDPOINT` configured as a runtime-only
 * variable would ship a policy with no bucket origin, and every signed transfer
 * would then be blocked by the browser with nothing to see server-side. A
 * production build therefore says out loud what it resolved, and refuses to
 * proceed on an endpoint it cannot parse.
 */
const storageOrigin = (() => {
  const endpoint = process.env.AWS_S3_ENDPOINT;
  if (!endpoint) {
    if (isProduction)
      console.warn(
        '[csp] AWS_S3_ENDPOINT is not set in the BUILD environment. connect-src will not name a storage origin; ' +
          'key rotation and direct file transfers will be blocked unless the bucket is reachable over plain https:. ' +
          'If the endpoint is configured for runtime only, expose it to the build as well.',
      );
    return null;
  }
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    // A malformed endpoint is a deployment error, not a reason to widen the
    // policy — and silently dropping it produces a failure with no server-side
    // symptom at all. Fail the build instead.
    throw new Error(`AWS_S3_ENDPOINT is not a valid URL: ${JSON.stringify(endpoint)}`);
  }
  if (isProduction) console.info(`[csp] connect-src storage origin: ${origin}`);
  return origin;
})();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https: wss:${storageOrigin ? ` ${storageOrigin}` : ''}`,
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  turbopack: {},
  skipTrailingSlashRedirect: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  async headers() {
    const securityHeaders = [
      { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // `camera=(self)`, not `camera=()`: the authenticator scans QR codes with
      // getUserMedia, and a bare `camera=()` disables it for our own origin.
      // Frames are decoded in the page and never uploaded.
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ];

    if (isProduction) {
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

const configWithSerwist = withSerwist(nextConfig);

// Sourcemap uploads are opt-in so local and E2E builds do not need PostHog's
// private build-time credentials. Vercel enables them by setting the project ID.
export default posthogProjectId && posthogApiKey
  ? withPostHogConfig(configWithSerwist, {
      personalApiKey: posthogApiKey,
      projectId: posthogProjectId,
      host: process.env.POSTHOG_HOST,
      sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
      },
    })
  : configWithSerwist;
