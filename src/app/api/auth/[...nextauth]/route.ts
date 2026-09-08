import NextAuth from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { isSessionRevoked } from '@/lib/routeAuth';

export const runtime = 'nodejs';

const handler = NextAuth(authOptions);

/**
 * Both cookie names NextAuth may have written, so the sign-out below works
 * whether or not the deployment is on https.
 */
const SESSION_COOKIES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

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
  if (!(await isSessionRevoked(typeof token?.sid === 'string' ? token.sid : null))) return null;

  const res = NextResponse.json({});
  for (const name of SESSION_COOKIES) {
    if (request.cookies.has(name)) res.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return res;
}

export async function GET(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await context.params;
  if (nextauth?.[0] === 'session') {
    const revoked = await revokedSessionResponse(request);
    if (revoked) return revoked;
  }
  return handler(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return handler(request, context);
}
