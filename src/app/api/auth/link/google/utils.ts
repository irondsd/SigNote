import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function getRedirectUri() {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const vercelUrl = process.env.VERCEL_URL;
  if (nextAuthUrl) return `${nextAuthUrl}/api/auth/link/google/callback`;
  if (vercelUrl) return `https://${vercelUrl}/api/auth/link/google/callback`;
  return 'http://localhost:5000/api/auth/link/google/callback';
}

/**
 * One-time value tying an authorization round trip to the browser that started
 * it. The nonce goes in a cookie; only its hash travels through Google in the
 * state JWT, so the state alone — which is visible in the authorization URL, in
 * Google's logs and in a Referer — proves nothing without the cookie.
 *
 * Without this, the state was a bearer token for "link an identity to user X":
 * anyone who could get a victim to open the attacker's authorization URL had
 * the victim's Google account attached to the *attacker's* SigNote account, and
 * the victim's next "Sign in with Google" landed inside it.
 */
export const LINK_STATE_COOKIE = 'signote.link.google';

/** Rejects a state JWT minted for anything other than this flow. */
export const LINK_STATE_PURPOSE = 'link:google';

export const newLinkNonce = (): string => randomBytes(32).toString('base64url');

export const hashLinkNonce = (nonce: string): string => createHash('sha256').update(nonce).digest('base64url');

export const linkNonceMatches = (nonce: string, expectedHash: string): boolean => {
  const actual = Buffer.from(hashLinkNonce(nonce));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
