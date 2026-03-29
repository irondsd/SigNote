import { NextResponse } from 'next/server';

import { eraseNotes } from '@/controllers/erase';
import { ERASE_ALL_SCOPE, withEraseAuth } from '@/lib/eraseAuth';

export const runtime = 'nodejs';

export const DELETE = withEraseAuth(ERASE_ALL_SCOPE, async (_req, userId) => {
  await eraseNotes(userId);
  return NextResponse.json({ ok: true });
});
