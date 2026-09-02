import { NextResponse } from 'next/server';
import { authorizeDesktopAuthAttempt } from '@/controllers/desktopAuth';
import { acceptsJson, isSameOriginMutation } from '@/lib/requestSecurity';
import { RouteAuthError, withSession } from '@/lib/routeAuth';
import { authorizeDesktopAttemptSchema } from '@/server/schemas/desktopAuth';

export const runtime = 'nodejs';

export const POST = withSession(async (request, { userId, provider }) => {
  if (!acceptsJson(request) || !isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (provider !== 'google') {
    throw new RouteAuthError(403, 'Google sign-in required');
  }

  const input = authorizeDesktopAttemptSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const authorized = await authorizeDesktopAuthAttempt({ ...input.data, userId });
  if (!authorized) {
    return NextResponse.json({ error: 'Desktop sign-in request is invalid or expired' }, { status: 400 });
  }

  const deepLink = new URL('signote://auth/callback');
  deepLink.searchParams.set('attempt', input.data.attemptId);
  deepLink.searchParams.set('code', authorized.authorizationCode);
  deepLink.searchParams.set('state', input.data.state);

  return NextResponse.json(
    { deepLink: deepLink.href, expiresAt: authorized.expiresAt.toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
