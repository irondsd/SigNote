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
  // Any signed-in browser session may authorize the desktop app; the provider
  // only labels the session it mints. A JWT without the claim predates the
  // sessions feature and has to be re-issued before it can vouch for a device.
  if (!provider) {
    throw new RouteAuthError(403, 'Sign in again to authorize the desktop app');
  }

  const input = authorizeDesktopAttemptSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const authorized = await authorizeDesktopAuthAttempt({ ...input.data, userId, provider });
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
