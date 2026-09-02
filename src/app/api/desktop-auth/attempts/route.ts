import { attachDatabasePool } from '@vercel/functions';
import { type NextRequest, NextResponse } from 'next/server';
import { canCreateDesktopAuthAttempt, createDesktopAuthAttempt } from '@/controllers/desktopAuth';
import { getClientIp } from '@/lib/clientIp';
import { acceptsJson, isSameOriginMutation } from '@/lib/requestSecurity';
import { createDesktopAttemptSchema } from '@/server/schemas/desktopAuth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!acceptsJson(request) || !isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const input = createDesktopAttemptSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const ip = getClientIp(request);
  if (!(await canCreateDesktopAuthAttempt(ip))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const attempt = await createDesktopAuthAttempt({
    state: input.data.state,
    codeChallenge: input.data.codeChallenge,
    ip,
  });
  const loginUrl = new URL('/desktop/login', request.url);
  loginUrl.searchParams.set('attempt', attempt.attemptId);
  loginUrl.searchParams.set('state', input.data.state);

  return NextResponse.json(
    { attemptId: attempt.attemptId, loginUrl: loginUrl.href, expiresAt: attempt.expiresAt.toISOString() },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
