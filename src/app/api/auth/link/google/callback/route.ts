import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

import { linkIdentity, ConflictEncryptedDataError, AlreadyLinkedError } from '@/controllers/identities';
import { RouteAuthError, authenticateRequest } from '@/lib/routeAuth';
import { LINK_STATE_COOKIE, LINK_STATE_PURPOSE, getRedirectUri, linkNonceMatches } from '../utils';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(buildProfileUrl('link_error=cancelled'));
  }

  const secret = process.env.NEXTAUTH_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!secret || !clientId || !clientSecret) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  // Verify state JWT, then prove this is the browser that started the flow.
  // The state alone is not enough: it rides in a URL the initiating user can
  // hand to anyone, so accepting it on its own let an attacker have a victim's
  // Google account linked to the attacker's SigNote account.
  let userId: string;
  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret));
    userId = payload.userId as string;
    if (!userId) throw new Error('No userId in state');
    if (payload.purpose !== LINK_STATE_PURPOSE) throw new Error('Wrong state purpose');

    const nonce = req.cookies.get(LINK_STATE_COOKIE)?.value;
    if (!nonce || typeof payload.nonce !== 'string' || !linkNonceMatches(nonce, payload.nonce)) {
      throw new Error('State does not match this browser');
    }
  } catch {
    return clearLinkCookie(NextResponse.redirect(buildProfileUrl('link_error=invalid_state')));
  }

  // …and that the browser is still signed in as the user the state names. The
  // cookie above proves same-browser; this proves same-account, so a stale flow
  // cannot land an identity on an account the visitor has since left.
  try {
    const { userId: sessionUserId } = await authenticateRequest(req);
    if (sessionUserId !== userId) throw new RouteAuthError(401, 'Unauthorized');
  } catch {
    return clearLinkCookie(NextResponse.redirect(buildProfileUrl('link_error=invalid_state')));
  }

  // Exchange code for tokens
  const tokenUrl = process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  // Fetch user info
  const userInfoUrl = process.env.GOOGLE_USERINFO_URL ?? 'https://www.googleapis.com/oauth2/v2/userinfo';
  const userInfoRes = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  const userInfo = (await userInfoRes.json()) as {
    id?: string;
    sub?: string;
    email?: string;
    verified_email?: boolean;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  const googleId = userInfo.id ?? userInfo.sub;
  if (!googleId) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  try {
    await linkIdentity(userId, 'google', googleId, {
      email: userInfo.email,
      emailVerified: userInfo.verified_email ?? userInfo.email_verified,
      rawProfileJson: { displayName: userInfo.name, image: userInfo.picture },
    });
    return clearLinkCookie(NextResponse.redirect(buildProfileUrl('linked=google')));
  } catch (err) {
    if (err instanceof ConflictEncryptedDataError) {
      return clearLinkCookie(NextResponse.redirect(buildProfileUrl('link_error=encrypted_data')));
    }
    if (err instanceof AlreadyLinkedError) {
      return clearLinkCookie(NextResponse.redirect(buildProfileUrl('link_error=already_linked')));
    }
    return clearLinkCookie(NextResponse.redirect(buildProfileUrl('link_error=server_error')));
  }
}

/** The nonce is single-use, so it goes whichever way the round trip ended. */
function clearLinkCookie(res: NextResponse): NextResponse {
  res.cookies.set(LINK_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

function buildProfileUrl(query: string) {
  const base =
    process.env.NEXTAUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5000');
  return `${base}/profile?${query}`;
}
