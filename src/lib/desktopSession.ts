import { eq } from 'drizzle-orm';
import { encode } from 'next-auth/jwt';
import { after, type NextRequest } from 'next/server';
import { AUTH_SESSION_MAX_AGE_SECONDS } from '@/config/authConstants';
import { upsertSessionIfMissing } from '@/controllers/authSessions';
import { getClientIp, getClientLocation } from '@/lib/clientIp';
import { sendSignInAlertEmail } from '@/lib/notificationEmails';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
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

export async function createDesktopSession(request: NextRequest, userId: string): Promise<DesktopSessionCookie | null> {
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
  const userAgent = request.headers.get('user-agent') ?? '';
  const expires = new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000);
  const token = await encode({
    token: {
      sub: userId,
      name: user.displayName,
      sid,
      provider: 'google',
      client: 'desktop',
    },
    secret,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });

  const parsed = parseUserAgent(userAgent);
  const created = await upsertSessionIfMissing({
    sid,
    userId,
    provider: 'google',
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
