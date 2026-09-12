import type { Metadata, Viewport } from 'next';
import { SYSTEM_BAR_COLOR } from '@/config/themeColors';
import { getDocs } from '@/config/docs';

export const SITE_NAME = 'SigNote';

/** What the product is, in one line. Also the OG image's subtitle. */
export const SITE_TAGLINE = 'End-to-end encrypted notes';

export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

/**
 * Kept at roughly a search snippet's length, and deliberately not tied to any
 * one sign-in method: the wallet was first, but Google, emailed codes and
 * passkeys are the same front door. What is constant is the encryption.
 */
export const SITE_DESCRIPTION =
  'End-to-end encrypted notes in three security tiers. Encryption happens in your browser — the server only ever stores ciphertext, and you can sign in anonymously.';

/** The longer pitch, for `/llms.txt` and anywhere a full paragraph fits. */
export const SITE_SUMMARY =
  'SigNote is a note-taking app built around one promise: the server cannot read what you have not chosen to let it read. Notes are kept in three security tiers — plain notes that stay searchable, secrets whose bodies are encrypted in the browser, and seals that each get their own key. Sign-in is passwordless: an emailed one-time code, Google, or an Ethereum wallet, with passkeys planned. Sign in with a wallet and no email address is involved at all.';

export const SITE_REPOSITORY = 'https://github.com/irondsd/signote';

/** The generated card image from `app/opengraph-image.tsx`. */
export const OG_IMAGE_PATH = '/opengraph-image';

const DEFAULT_SITE_URL = 'http://localhost:5000';

/** Public, crawlable routes. Everything else in the app sits behind sign-in. */
const STATIC_SITEMAP_ROUTES = ['/', '/docs', '/support'] as const;

/**
 * Signed-in surfaces. They render nothing for a crawler, so they are kept out
 * of the sitemap and out of robots.txt's crawl budget. Prefix matches, so
 * `/seals` also covers `/seals/archive`.
 */
export const PRIVATE_ROUTE_PREFIXES = [
  '/api/',
  '/desktop/',
  '/archive',
  '/auth',
  '/backup-recovery',
  '/change-passphrase',
  '/erase',
  '/notifications',
  '/profile',
  '/recover',
  '/rotate-keys',
  '/search',
  '/seals',
  '/secrets',
  '/sessions',
  '/tags',
] as const;

function normalizeSiteUrl(rawUrl?: string) {
  if (!rawUrl) {
    return DEFAULT_SITE_URL;
  }

  return rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`;
}

export function getSiteUrl() {
  return new URL(
    normalizeSiteUrl(
      process.env.NEXTAUTH_URL ??
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.VERCEL_PROJECT_PRODUCTION_URL ??
        process.env.VERCEL_URL,
    ),
  );
}

export const siteUrl = getSiteUrl();

export const viewport: Viewport = {
  colorScheme: 'light dark',
  // One value, not a `prefers-color-scheme` pair: it has to agree with the
  // manifest's `theme_color`, which cannot vary by scheme. See `SYSTEM_BAR_COLOR`.
  themeColor: SYSTEM_BAR_COLOR,
};

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: 'productivity',
  alternates: {
    canonical: '/',
  },
  keywords: [
    'SigNote',
    'encrypted notes',
    'end-to-end encrypted notes',
    'client-side encryption',
    'zero-knowledge notes',
    'private notes app',
    'anonymous notes',
    'password manager alternative',
    'passkey sign-in',
    'Sign-In with Ethereum',
    'SIWE',
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: SITE_NAME,
  },
  manifest: '/manifest.webmanifest',
};

export function getSitemapRoutes() {
  return [...STATIC_SITEMAP_ROUTES, ...getDocs().map((doc) => doc.href)];
}
