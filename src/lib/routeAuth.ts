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
  params: Record<string, string>;
}

type AuthedHandler = (req: NextRequest, ctx: AuthedContext) => Promise<NextResponse>;

export function withSession(
  handler: AuthedHandler,
): (req: NextRequest, nextCtx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, nextCtx) => {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const userId = typeof token?.sub === 'string' ? token.sub : null;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sid = typeof token?.sid === 'string' ? token.sid : null;
    const provider = token?.provider;

    // Per-request session validation. Legacy JWTs (no sid) bypass — they expire
    // naturally within 7 days of the deploy of this feature.
    if (sid) {
      const row = await findSessionForValidation(sid);
      const now = Date.now();

      if (row && (row.revokedAt !== null || row.expiresAt.getTime() < now)) {
        return NextResponse.json({ error: 'Session revoked' }, { status: 401 });
      }

      if (!row) {
        // First authed request after sign-in: lazy-create the audit row. We need
        // the provider claim that was set during the jwt callback to know how
        // the user signed in.
        if (provider === 'google' || provider === 'siwe') {
          const ip = getClientIp(req);
          const userAgent = req.headers.get('user-agent') ?? '';
          const parsed = parseUserAgent(userAgent);
          await upsertSessionIfMissing({
            sid,
            userId,
            provider,
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

    const params = nextCtx?.params ? await nextCtx.params : {};

    try {
      return await handler(req, { userId, sid, params });
    } catch (err) {
      if (err instanceof RouteAuthError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
  };
}

export function assertOwner<T extends { userId: string }>(resource: T | null | undefined, callerId: string): T {
  if (!resource) {
    throw new RouteAuthError(404, 'Not found');
  }
  if (resource.userId !== callerId) {
    throw new RouteAuthError(403, 'Forbidden');
  }
  return resource;
}
