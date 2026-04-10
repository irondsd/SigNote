import fs from 'fs';
import path from 'path';
import type { Metadata, Viewport } from 'next';

const SITE_NAME = 'SigNote';
const SITE_DESCRIPTION =
  'Wallet-native notes with searchable notes, encrypted secrets, and sealed notes secured client-side.';
const DEFAULT_SITE_URL = 'http://localhost:5000';

const STATIC_SITEMAP_ROUTES = [
  '/',
  '/archive',
  '/profile',
  '/secrets',
  '/secrets/archive',
  '/seals',
  '/seals/archive',
  '/change-passphrase',
  '/erase-encryption',
  '/erase',
  '/docs',
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
  themeColor: [
    {
      media: '(prefers-color-scheme: light)',
      color: '#FDF8F4',
    },
    {
      media: '(prefers-color-scheme: dark)',
      color: '#1E150D',
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  keywords: ['SigNote', 'secure notes', 'encrypted notes', 'SIWE', 'wallet auth', 'privacy'],
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: SITE_NAME,
  },
  manifest: '/manifest.webmanifest',
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export function getDocsSlugs() {
  const docsDir = path.join(process.cwd(), 'src/docs');

  return fs
    .readdirSync(docsDir)
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const withoutExt = fileName.replace(/\.md$/, '');
      const dotIndex = withoutExt.indexOf('.');

      return dotIndex === -1 ? null : withoutExt.slice(dotIndex + 1);
    })
    .filter((slug): slug is string => slug !== null);
}

export function getSitemapRoutes() {
  return [...STATIC_SITEMAP_ROUTES, ...getDocsSlugs().map((slug) => `/docs/${slug}`)];
}
