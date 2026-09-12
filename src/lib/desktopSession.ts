import { eq } from 'drizzle-orm';
import { encode } from 'next-auth/jwt';
import { after, type NextRequest } from 'next/server';
import { AUTH_SESSION_MAX_AGE_SECONDS } from '@/config/authConstants';
import { captureSessionEpoch, upsertSessionIfMissing } from '@/controllers/authSessions';
import { getClientIp, getClientLocation } from '@/lib/clientIp';
import { sendSignInAlertEmail } from '@/lib/notificationEmails';
import { getDb } from '@/db/client';
import { users, type AuthProvider } from '@/db/schema';
import { parseUserAgent } from '@/lib/uaParser';
import { v7 as uuidv7 } from 'uuid';

export type DesktopSessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    path: '/';
    secure: boolean;
    maxAge: number;
    expires: Date;
  };
};

/**
 * Mints the desktop app's own session after a successful PKCE exchange.
 * `provider` is how the *browser* session that authorized the attempt was
 * signed in — the desktop session inherits the label so the device list is
 * honest about it. Display metadata only, never a trust boundary.
 */
export async function createDesktopSession(
  request: NextRequest,
  userId: string,
  provider: AuthProvider,
): Promise<DesktopSessionCookie | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Missing NEXTAUTH_SECRET');

  const found = await getDb()
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = found[0];
  if (!user) return null;

  const sid = uuidv7();
  const sessionEpoch = await captureSessionEpoch(userId, sid);
  const userAgent = request.headers.get('user-agent') ?? '';
  const expires = new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000);
  const token = await encode({
    token: {
      sub: userId,
      name: user.displayName,
      sid,
      sessionEpoch,
      provider,
      client: 'desktop',
    },
    secret,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });

  const parsed = parseUserAgent(userAgent);
  const created = await upsertSessionIfMissing({
    sid,
    userId,
    sessionEpoch,
    provider,
    client: 'desktop',
    ip: getClientIp(request),
    userAgent,
    ...parsed,
  });

  // Same alert as the web path — the desktop app mints its session here rather
  // than on the first authed request.
  if (created) {
    const location = getClientLocation(request);
    after(() => sendSignInAlertEmail(userId, { browser: parsed.browser, os: parsed.os, location, when: new Date() }));
  }

  const secure = new URL(process.env.NEXTAUTH_URL ?? request.url).protocol === 'https:';
  return {
    name: `${secure ? '__Secure-' : ''}next-auth.session-token`,
    value: token,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
      expires,
    },
  };
}
