import type { MetadataRoute } from 'next';
import { INSTALLED_CHROME_COLOR, INSTALLED_SPLASH_COLOR } from '@/config/themeColors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SigNote',
    short_name: 'SigNote',
    description: 'Secure note-keeping with Ethereum wallet authentication',
    start_url: '/',
    display: 'standalone',
    // Android paints the installed app's status bar from `theme_color` and
    // will not vary it by color scheme, so both themes get the same dark system
    // chrome and `ThemeColorMeta` matches it. See `INSTALLED_CHROME_COLOR`.
    background_color: INSTALLED_SPLASH_COLOR,
    theme_color: INSTALLED_CHROME_COLOR,
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
