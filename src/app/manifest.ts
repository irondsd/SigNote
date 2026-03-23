import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SigNote',
    short_name: 'SigNote',
    description: 'Secure note-keeping with Ethereum wallet authentication',
    start_url: '/',
    display: 'standalone',
    background_color: '#FDF8F4',
    theme_color: '#FDF8F4',
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
