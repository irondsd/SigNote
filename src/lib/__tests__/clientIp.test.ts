import { getClientLocation } from '@/lib/clientIp';

const requestWithGeo = (headers: Record<string, string>) =>
  new Request('https://signote.app/api/trpc/test', { headers });

describe('getClientLocation', () => {
  it('formats Vercel city and country headers for the sign-in email', () => {
    const request = requestWithGeo({
      'x-vercel-ip-city': 'Buenos%20Aires',
      'x-vercel-ip-country': 'AR',
    });

    expect(getClientLocation(request)).toBe('Buenos Aires, Argentina');
  });

  it('decodes non-ASCII city names through the Vercel helper', () => {
    const request = requestWithGeo({
      'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
      'x-vercel-ip-country': 'BR',
    });

    expect(getClientLocation(request)).toBe('São Paulo, Brazil');
  });

  it('uses the full country name when Vercel cannot resolve a city', () => {
    const request = requestWithGeo({ 'x-vercel-ip-country': 'AR' });

    expect(getClientLocation(request)).toBe('Argentina');
  });

  it('returns undefined when no geolocation headers are available', () => {
    expect(getClientLocation(requestWithGeo({}))).toBeUndefined();
  });
});
