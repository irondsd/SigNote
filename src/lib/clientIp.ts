import { geolocation } from '@vercel/functions';
import type { NextRequest } from 'next/server';

/**
 * Best-effort extraction of the client IP from a request. Trusts the standard
 * proxy headers — fine for Vercel-style deployments where the platform sets them.
 */
export const getClientIp = (req: NextRequest | Request): string => {
  const headers = req.headers;

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return '';
};

/**
 * Coarse "City, Country" from the platform's geo headers, for the new-sign-in
 * email. Undefined off Vercel — locally there are no such headers — and the
 * template says so rather than inventing a location.
 */
export const getClientLocation = (req: NextRequest | Request): string | undefined => {
  // `geolocation` already percent-decodes the header values, so don't decode
  // again — a city containing a literal '%' would throw.
  const { city, country } = geolocation(req as NextRequest);
  const parts = [city, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
};
