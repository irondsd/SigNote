import NextAuth from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { isSessionRevoked } from '@/lib/routeAuth';

export const runtime = 'nodejs';

const handler = NextAuth(authOptions);

/**
 * Both cookie names NextAuth may have written, including numbered chunks.
 */
const SESSION_COOKIE = /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/;

/**
 * `/api/auth/session` is the one authenticated endpoint NextAuth answers by
 * itself: it decodes the JWT, runs the session callback and re-issues the
 * cookie, none of which consults `auth_sessions`. Revoking a device therefore
 * 401'd its API calls while this endpoint kept reporting it as signed in — and
 * kept rolling its cookie forward, so the JWT never aged out either.
 *
 * The check lives here rather than in the session callback because the callback
 * cannot stop the cookie from being rotated; returning the signed-out shape
 * with the cookie cleared is what actually ends the session.
 */
async function revokedSessionResponse(request: NextRequest): Promise<NextResponse | null> {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const sid = typeof token?.sid === 'string' ? token.sid : null;

  // A signed-in token with no sid predates the sessions feature, so there is no
  // row to revoke and no entry in the device list — and this endpoint is exactly
  // what kept it alive, re-issuing the cookie on every page load and focus. It
  // is unrevokable by construction, so treat it as revoked: clearing the cookie
  // here is the only thing that ends it. `authenticateRequest` 401s it too.
  const unrevokable = typeof token?.sub === 'string' && sid === null;
  if (!unrevokable && !(await isSessionRevoked(sid))) return null;

  const res = NextResponse.json({});
  for (const { name } of request.cookies.getAll()) {
    if (SESSION_COOKIE.test(name)) {
      res.cookies.set(name, '', { path: '/', maxAge: 0, httpOnly: true, secure: name.startsWith('__Secure-') });
    }
  }
  return res;
}

async function handleAuth(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await context.params;
  if (nextauth?.[0] === 'session') {
    const revoked = await revokedSessionResponse(request);
    if (revoked) return revoked;
  }
  return handler(request, context);
}

// NextAuth renews JWTs through both GET session reads and POST session updates.
export { handleAuth as GET, handleAuth as POST };
