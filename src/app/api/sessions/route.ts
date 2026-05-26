import { NextResponse } from 'next/server';

import { listUserSessions, revokeAllOtherSessions } from '@/controllers/authSessions';
import { withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const GET = withSession(async (_req, { userId, sid }) => {
  const sessions = await listUserSessions(userId);

  const annotated = sessions.map((s) => ({
    _id: s._id.toString(),
    provider: s.provider,
    ip: s.ip,
    browser: s.browser,
    os: s.os,
    deviceType: s.deviceType,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    expiresAt: s.expiresAt,
    current: sid !== null && s._id.toString() === sid,
  }));

  return NextResponse.json({ sessions: annotated });
});

export const DELETE = withSession(async (_req, { userId, sid }) => {
  if (!sid) {
    // Legacy JWT with no session id — nothing to anchor "current" to. Refuse
    // rather than risk revoking the requester's own session.
    return NextResponse.json(
      { error: 'Cannot revoke from a legacy session. Sign out and back in first.' },
      { status: 400 },
    );
  }
  const revoked = await revokeAllOtherSessions(userId, sid);
  return NextResponse.json({ revoked });
});
