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
