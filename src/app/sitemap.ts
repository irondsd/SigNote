import type { MetadataRoute } from 'next';
import { getSiteUrl, getSitemapRoutes } from '@/config/meta';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  return getSitemapRoutes().map((route) => ({
    url: new URL(route, siteUrl).toString(),
    lastModified,
    changeFrequency: route === '/' ? 'weekly' : 'monthly',
    priority: route === '/' ? 1 : route === '/docs/about' ? 0.9 : 0.7,
  }));
}
