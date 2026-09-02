import mongoose from 'mongoose';
import { encode } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { AUTH_SESSION_MAX_AGE_SECONDS } from '@/config/authConstants';
import { upsertSessionIfMissing } from '@/controllers/authSessions';
import { getClientIp } from '@/lib/clientIp';
import { parseUserAgent } from '@/lib/uaParser';
import { UserModel } from '@/models/User';

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

  const user = await UserModel.findById(userId).lean().exec();
  if (!user) return null;

  const sid = new mongoose.Types.ObjectId().toString();
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

  await upsertSessionIfMissing({
    sid,
    userId,
    provider: 'google',
    client: 'desktop',
    ip: getClientIp(request),
    userAgent,
    ...parseUserAgent(userAgent),
  });

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
