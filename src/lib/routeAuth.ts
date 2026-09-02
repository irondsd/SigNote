import { attachDatabasePool } from '@vercel/functions';
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse, after } from 'next/server';

import {
  TOUCH_THROTTLE_MS,
  findSessionForValidation,
  touchSession,
  upsertSessionIfMissing,
} from '@/controllers/authSessions';
import { getClientIp } from '@/lib/clientIp';
import { parseUserAgent } from '@/lib/uaParser';
import type { AuthProvider } from '@/models/AuthSession';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

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
 * Resolves the authenticated user for a request: decodes the JWT, runs
 * per-request session validation (revocation/expiry, lazy audit-row create,
 * throttled activity touch) and attaches the DB pool. Throws `RouteAuthError`
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
  const provider = token?.provider === 'google' || token?.provider === 'siwe' ? token.provider : null;

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
        await upsertSessionIfMissing({
          sid,
          userId,
          provider,
          client: token?.client === 'desktop' ? 'desktop' : 'web',
          ip,
          userAgent,
          ...parsed,
        });
      }
    } else if (now - row.updatedAt.getTime() > TOUCH_THROTTLE_MS) {
      // Slide the activity window. Fire-and-forget via `after` so the response
      // isn't held up by the write — serverless-safe.
      const ip = getClientIp(req);
      const userAgent = req.headers.get('user-agent') ?? '';
      after(() => touchSession(sid, ip, userAgent));
    }
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

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
