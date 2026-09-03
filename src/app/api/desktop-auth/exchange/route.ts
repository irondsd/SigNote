import { type NextRequest, NextResponse } from 'next/server';
import { consumeDesktopAuthAttempt } from '@/controllers/desktopAuth';
import { createDesktopSession } from '@/lib/desktopSession';
import { acceptsJson, isSameOriginMutation } from '@/lib/requestSecurity';
import { exchangeDesktopAttemptSchema } from '@/server/schemas/desktopAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!acceptsJson(request) || !isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const input = exchangeDesktopAttemptSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const consumed = await consumeDesktopAuthAttempt({
    attemptId: input.data.attemptId,
    state: input.data.state,
    authorizationCode: input.data.code,
    codeVerifier: input.data.codeVerifier,
  });

  if (!consumed.ok) {
    const status = consumed.reason === 'rate_limited' ? 429 : consumed.reason === 'already_consumed' ? 409 : 400;
    return NextResponse.json({ error: 'Desktop sign-in request is invalid or expired' }, { status });
  }

  const cookie = await createDesktopSession(request, consumed.userId);
  if (!cookie) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
