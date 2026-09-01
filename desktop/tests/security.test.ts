import { describe, expect, test } from 'bun:test';
import {
  isAllowedAppNavigation,
  isAllowedBrowserLoginUrl,
  isSafeExternalUrl,
  resolveAppOrigin,
} from '../src/security';

describe('resolveAppOrigin', () => {
  test('uses localhost for an unpackaged development build', () => {
    expect(resolveAppOrigin(false, undefined).href).toBe('http://localhost:5000/');
  });

  test('uses the production origin for a packaged build', () => {
    expect(resolveAppOrigin(true, undefined).href).toBe('https://signote.app/');
  });

  test('allows an HTTPS override', () => {
    expect(resolveAppOrigin(true, 'https://staging.signote.app').origin).toBe('https://staging.signote.app');
  });

  test('allows HTTP only for local development', () => {
    expect(resolveAppOrigin(false, 'http://127.0.0.1:5000').origin).toBe('http://127.0.0.1:5000');
    expect(() => resolveAppOrigin(true, 'http://localhost:5000')).toThrow('requires HTTPS');
    expect(() => resolveAppOrigin(false, 'http://staging.signote.app')).toThrow('requires HTTPS');
  });

  test('rejects values that are not bare origins', () => {
    expect(() => resolveAppOrigin(false, 'https://signote.app/notes')).toThrow('must be an origin');
    expect(() => resolveAppOrigin(false, 'https://user:pass@signote.app')).toThrow('must be an origin');
  });
});

describe('navigation policy', () => {
  const appOrigin = new URL('https://signote.app');

  test('allows paths on the configured application origin', () => {
    expect(isAllowedAppNavigation('https://signote.app/notes?id=123', appOrigin)).toBe(true);
  });

  test('allows only the desktop login path on the configured origin', () => {
    expect(isAllowedBrowserLoginUrl('https://signote.app/desktop/login?attempt=abc', appOrigin)).toBe(true);
    expect(isAllowedBrowserLoginUrl('https://signote.app/desktop/login#token', appOrigin)).toBe(false);
    expect(isAllowedBrowserLoginUrl('https://signote.app/api/auth/session', appOrigin)).toBe(false);
    expect(isAllowedBrowserLoginUrl('https://attacker.example/desktop/login', appOrigin)).toBe(false);
  });

  test('rejects sibling domains, insecure URLs, and deceptive hostnames', () => {
    expect(isAllowedAppNavigation('https://accounts.google.com', appOrigin)).toBe(false);
    expect(isAllowedAppNavigation('http://signote.app', appOrigin)).toBe(false);
    expect(isAllowedAppNavigation('https://signote.app.attacker.example', appOrigin)).toBe(false);
  });

  test('opens only credential-free HTTPS URLs externally', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(false);
    expect(isSafeExternalUrl('mailto:user@example.com')).toBe(false);
    expect(isSafeExternalUrl('https://user:password@example.com')).toBe(false);
    expect(isSafeExternalUrl('signote://auth/callback')).toBe(false);
  });
});
