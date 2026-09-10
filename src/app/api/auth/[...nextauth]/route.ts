import NextAuth from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { isSessionUnusable } from '@/lib/routeAuth';

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

  // No signed-in token at all: nothing of ours to end, so let NextAuth answer.
  if (typeof token?.sub !== 'string') return null;

  const sid = typeof token.sid === 'string' ? token.sid : null;

  // `isSessionUnusable` covers both cases that have to end here. A revoked or
  // expired row is the obvious one. The other is a token carrying no sid: it
  // predates the sessions feature, so there is no row to revoke and no entry in
  // the device list, and this endpoint is exactly what kept it alive by
  // re-issuing the cookie on every page load and focus. `authenticateRequest`
  // 401s it; clearing the cookie here is what actually ends it.
  if (!(await isSessionUnusable(sid))) return null;

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
