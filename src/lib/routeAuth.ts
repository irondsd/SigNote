import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse, after } from 'next/server';

import {
  TOUCH_THROTTLE_MS,
  findSessionForValidation,
  touchSession,
  upsertSessionIfMissing,
} from '@/controllers/authSessions';
import { getClientIp, getClientLocation } from '@/lib/clientIp';
import { sendSignInAlertEmail } from '@/lib/notificationEmails';
import { parseUserAgent } from '@/lib/uaParser';
import type { AuthProvider } from '@/db/schema';
import { parseWebSessionClient, SESSION_CLIENT_HEADER } from '@/lib/sessionClient';

export class RouteAuthError extends Error {
  readonly status: 401 | 403 | 404;
  readonly body: Record<string, string>;

  constructor(status: 401 | 403 | 404, message: string) {
    super(message);
    this.status = status;
    this.body = { error: message };
  }
}

export interface AuthedContext {
  userId: string;
  sid: string | null;
  provider: AuthProvider | null;
  params: Record<string, string>;
}

type AuthedHandler = (req: NextRequest, ctx: AuthedContext) => Promise<NextResponse>;

/**
 * Resolves the authenticated user for a request: decodes the JWT and runs
 * per-request session validation (revocation/expiry, lazy audit-row create,
 * throttled activity touch). Throws `RouteAuthError`
 * on any auth failure. Shared by `withSession` (REST) and the tRPC context so
 * the security-sensitive path has a single source of truth.
 */
export async function authenticateRequest(
  req: NextRequest,
): Promise<{ userId: string; sid: string | null; provider: AuthProvider | null }> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const userId = typeof token?.sub === 'string' ? token.sub : null;

  if (!userId) {
    throw new RouteAuthError(401, 'Unauthorized');
  }

  const sid = typeof token?.sid === 'string' ? token.sid : null;
  const provider =
    token?.provider === 'google' || token?.provider === 'siwe' || token?.provider === 'email' ? token.provider : null;
  const requestClient =
    token?.client === 'desktop' ? 'desktop' : parseWebSessionClient(req.headers.get(SESSION_CLIENT_HEADER));

  // Per-request session validation. Legacy JWTs (no sid) bypass — they expire
  // naturally within 7 days of the deploy of this feature.
  if (sid) {
    const row = await findSessionForValidation(sid);
    const now = Date.now();

    if (row && (row.revokedAt !== null || row.expiresAt.getTime() < now)) {
      throw new RouteAuthError(401, 'Session revoked');
    }

    if (!row) {
      // First authed request after sign-in: lazy-create the audit row. We need
      // the provider claim that was set during the jwt callback to know how
      // the user signed in.
      if (provider) {
        const ip = getClientIp(req);
        const userAgent = req.headers.get('user-agent') ?? '';
        const parsed = parseUserAgent(userAgent);
        const created = await upsertSessionIfMissing({
          sid,
          userId,
          provider,
          client: requestClient,
          ip,
          userAgent,
          ...parsed,
        });

        // One row per sign-in, so this fires once per sign-in and not on every
        // request. `after` keeps the send off the response path.
        if (created) {
          const location = getClientLocation(req);
          after(() =>
            sendSignInAlertEmail(userId, {
              browser: parsed.browser,
              os: parsed.os,
              location,
              when: new Date(),
            }),
          );
        }
      }
    } else if (row.client === 'web' && requestClient === 'pwa') {
      // A browser session may predate installation or share its cookie with
      // the installed app. Promote it immediately so the sessions query that
      // triggered this request can return the PWA badge on its first render.
      const ip = getClientIp(req);
      const userAgent = req.headers.get('user-agent') ?? '';
      await touchSession(sid, ip, userAgent, 'pwa');
    } else if (now - row.updatedAt.getTime() > TOUCH_THROTTLE_MS) {
      // Slide the activity window. Fire-and-forget via `after` so the response
      // isn't held up by the write — serverless-safe.
      const ip = getClientIp(req);
      const userAgent = req.headers.get('user-agent') ?? '';
      after(() => touchSession(sid, ip, userAgent));
    }
  }

  return { userId, sid, provider };
}

export function withSession(
  handler: AuthedHandler,
): (req: NextRequest, nextCtx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, nextCtx) => {
    let auth;
    try {
      auth = await authenticateRequest(req);
    } catch (err) {
      if (err instanceof RouteAuthError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }

    const params = nextCtx?.params ? await nextCtx.params : {};

    try {
      return await handler(req, { userId: auth.userId, sid: auth.sid, provider: auth.provider, params });
    } catch (err) {
      if (err instanceof RouteAuthError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
  };
}
