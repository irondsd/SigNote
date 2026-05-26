import { NextResponse } from 'next/server';

import { revokeSession } from '@/controllers/authSessions';
import { withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { userId, sid, params }) => {
  const targetId = params.id;
  if (!targetId) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }

  const ok = await revokeSession(targetId, userId);
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ revoked: true, wasCurrent: targetId === sid });
});
