import { NextResponse } from 'next/server';

import { eraseSeals } from '@/controllers/erase';
import { ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE, withEraseAuth } from '@/lib/eraseAuth';

export const runtime = 'nodejs';

export const DELETE = withEraseAuth([ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE], async (_req, userId) => {
  await eraseSeals(userId);
  return NextResponse.json({ ok: true });
});
