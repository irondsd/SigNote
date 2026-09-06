import type { MetadataRoute } from 'next';
import { SPLASH_COLOR, SYSTEM_BAR_COLOR } from '@/config/themeColors';
import { SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from '@/config/meta';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${SITE_NAME} — ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: 'en',
    dir: 'ltr',
    categories: ['productivity', 'utilities', 'security'],
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // The installed app's status bar is frozen at this value — baked into the
    // WebAPK at install time, and no runtime tag can repaint it — so
    // `viewport.themeColor` names the same color. See `SYSTEM_BAR_COLOR`.
    background_color: SPLASH_COLOR,
    theme_color: SYSTEM_BAR_COLOR,
    icons: [
      { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
