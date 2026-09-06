import type { MetadataRoute } from 'next';
import { getSiteUrl, PRIVATE_ROUTE_PREFIXES } from '@/config/meta';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // The marketing surface is `/` and `/docs/*`; everything else is behind
      // sign-in and renders an empty shell to a crawler.
      disallow: [...PRIVATE_ROUTE_PREFIXES],
    },
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    host: siteUrl.origin,
  };
}
