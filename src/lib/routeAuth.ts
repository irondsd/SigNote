import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse, after } from 'next/server';

import { VaultConflictError, getEncryptionState, withRequestGeneration } from '@/db/encryptionState';
import {
  isSessionEpochAllowed,
  SessionEpochError,
  type SessionEpochClaim,
  type SessionValidationContext,
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

/**
 * A session row that must no longer authenticate anything: explicitly revoked,
 * or past the sliding expiry that `touchSession` maintains.
 */
const isDeadSession = (row: { revokedAt: Date | null; expiresAt: Date }): boolean =>
  row.revokedAt !== null || row.expiresAt.getTime() <= Date.now();

/**
 * Whether the `sid` decoded from a JWT may no longer authenticate anything.
 * For callers that resolve a session without going through
 * `authenticateRequest` — today only NextAuth's own `/api/auth/session`, which
 * decodes the JWT and knows nothing about the `auth_sessions` table.
 *
 * Named for the unusable case and fails closed on a missing sid, so a caller
 * that trusts the name inherits the policy rather than an exemption: a sid is
 * required, and `authenticateRequest` rejects a token without one outright.
 *
 * A sid whose row does not exist *yet* is usable while the account epoch
 * permits the lazy-create window. Once an epoch is active, even the explicit
 * survivor must still have its ordinary audit row so cleanup cannot recreate
 * an expired or revoked session.
 */
export async function isSessionUnusable(
  sid: string | null | undefined,
  account: SessionValidationContext,
): Promise<boolean> {
  if (!sid || !account?.userId) return true;
  const row = await findSessionForValidation(sid);
  if (row && row.userId !== account.userId) return true;
  if (row && isDeadSession(row)) return true;
  const state = await getEncryptionState(account.userId);
  if (!row && state.sessionEpoch > 0 && state.survivingSid === sid) return true;
  return !isSessionEpochAllowed(state, sid, account.sessionEpoch);
}

/** Decode the numeric epoch claim without treating malformed input as legacy. */
export function readSessionEpochClaim(value: unknown): SessionEpochClaim {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export interface AuthedContext {
  userId: string;
  sid: string;
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
): Promise<{ userId: string; sid: string; provider: AuthProvider | null }> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const userId = typeof token?.sub === 'string' ? token.sub : null;

  if (!userId) {
    throw new RouteAuthError(401, 'Unauthorized');
  }

  const sid = typeof token?.sid === 'string' ? token.sid : null;
  const provider =
    token?.provider === 'google' ||
    token?.provider === 'siwe' ||
    token?.provider === 'email' ||
    token?.provider === 'passkey'
      ? token.provider
      : null;
  const requestClient =
    token?.client === 'desktop' ? 'desktop' : parseWebSessionClient(req.headers.get(SESSION_CLIENT_HEADER));

  // Per-request session validation. A JWT with no sid predates the sessions
  // feature and can never be revoked: it is absent from the device list and
  // from "sign out everywhere else", and NextAuth re-issues it with a fresh
  // expiry on every `/api/auth/session` call, so it never ages out on its own
  // either. Reject it and make the holder sign in again.
  if (!sid) {
    throw new RouteAuthError(401, 'Unauthorized');
  }

  const sessionEpoch = readSessionEpochClaim(token?.sessionEpoch);
  const state = await getEncryptionState(userId);
  const row = await findSessionForValidation(sid);
  const now = Date.now();

  if (row && row.userId !== userId) {
    throw new RouteAuthError(401, 'Session revoked');
  }

  // Check the immutable token claim before the lazy-row path. The surviving
  // sid is the only exception to an older epoch; every other stale or legacy
  // token must be rejected before it can create an audit row.
  if (!isSessionEpochAllowed(state, sid, sessionEpoch)) {
    throw new RouteAuthError(401, 'Session revoked');
  }

  // The survivor exception still requires its ordinary audit row. If the row
  // has been removed, fail closed instead of allowing lazy creation to
  // resurrect a session whose expiry/revocation history is gone.
  if (!row && state.sessionEpoch > 0 && state.survivingSid === sid) {
    throw new RouteAuthError(401, 'Session revoked');
  }

  if (row && isDeadSession(row)) {
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
      let created: boolean;
      try {
        created = await upsertSessionIfMissing({
          sid,
          userId,
          sessionEpoch,
          provider,
          client: requestClient,
          ip,
          userAgent,
          ...parsed,
        });
      } catch (err) {
        // The state may have changed after the read above but before the
        // account-locked lazy create. Surface the same auth failure as the
        // preflight check and never let the handler run on a stale token.
        if (err instanceof SessionEpochError) throw new RouteAuthError(401, 'Session revoked');
        throw err;
      }

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
        return NextResponse.json(err.body, { status: err.status, headers: { 'Cache-Control': 'private, no-store' } });
      }
      throw err;
    }

    const params = nextCtx?.params ? await nextCtx.params : {};

    try {
      const response = await withRequestGeneration(req.headers.get('x-signote-encryption-generation'), () =>
        handler(req, { userId: auth.userId, sid: auth.sid, provider: auth.provider, params }),
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    } catch (err) {
      if (err instanceof RouteAuthError) {
        return NextResponse.json(err.body, { status: err.status, headers: { 'Cache-Control': 'private, no-store' } });
      }
      if (err instanceof VaultConflictError) {
        return NextResponse.json(
          { error: err.code },
          {
            status: err.code === 'INVALID_GENERATION' ? 400 : 409,
            headers: { 'Cache-Control': 'private, no-store' },
          },
        );
      }
      throw err;
    }
  };
}
