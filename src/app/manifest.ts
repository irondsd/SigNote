import type { MetadataRoute } from 'next';
import { MANIFEST_THEME_COLOR, SPLASH_COLOR } from '@/config/themeColors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SigNote',
    short_name: 'SigNote',
    description: 'Secure note-keeping with Ethereum wallet authentication',
    start_url: '/',
    display: 'standalone',
    // One fixed value: a manifest cannot vary by color scheme, and this is what
    // the installed app shows before the page can report a theme. `ThemeColorMeta`
    // takes the bar over from there. See `MANIFEST_THEME_COLOR`.
    background_color: SPLASH_COLOR,
    theme_color: MANIFEST_THEME_COLOR,
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
