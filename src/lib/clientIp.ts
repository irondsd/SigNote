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

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Turn Vercel's ISO 3166-1 country code into the name used in the email. */
const getCountryName = (country: string | undefined): string | undefined => {
  if (!country) return undefined;

  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return country;

  // `of` may return the input for a well-formed code that ICU does not know.
  return countryNames.of(code) ?? country;
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
  const parts = [city, getCountryName(country)].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
};
