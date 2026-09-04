import type { MetadataRoute } from 'next';
import { BACKGROUND_COLOR_LIGHT, THEME_COLOR_LIGHT } from '@/config/themeColors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SigNote',
    short_name: 'SigNote',
    description: 'Secure note-keeping with Ethereum wallet authentication',
    start_url: '/',
    display: 'standalone',
    // A manifest takes one value and cannot follow `prefers-color-scheme`, so
    // these are the light-theme surfaces (the default) and only cover install
    // and splash; the live status bar comes from the meta tag instead.
    background_color: BACKGROUND_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
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
