import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';

import { RouteAuthError, authenticateRequest } from '@/lib/routeAuth';
import { LINK_STATE_COOKIE, LINK_STATE_PURPOSE, getRedirectUri, hashLinkNonce, newLinkNonce } from '../utils';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // `authenticateRequest`, not `getServerSession`: the latter only decodes the
  // JWT, so a revoked device could still start a link against the account it
  // had just been thrown out of.
  let userId: string;
  try {
    ({ userId } = await authenticateRequest(req));
  } catch (err) {
    if (err instanceof RouteAuthError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Sign a state JWT containing the userId (expires in 10 min). It also carries
  // the hash of a nonce whose plaintext stays in this browser's cookie, so the
  // callback can tell "the browser that started this flow came back" from "some
  // browser was handed this URL".
  const nonce = newLinkNonce();
  const state = await new SignJWT({ userId, purpose: LINK_STATE_PURPOSE, nonce: hashLinkNonce(nonce) })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));

  const redirectUri = getRedirectUri();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
  });

  const authUrl = process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth';
  const res = NextResponse.redirect(`${authUrl}?${params}`);
  // Lax, because the return trip is a top-level GET navigation from Google.
  res.cookies.set(LINK_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
    maxAge: 10 * 60,
  });
  return res;
}
