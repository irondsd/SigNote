import { NextResponse } from 'next/server';

import { eraseSecrets } from '@/controllers/erase';
import { ERASE_ALL_SCOPE, withEraseAuth } from '@/lib/eraseAuth';

export const runtime = 'nodejs';

export const DELETE = withEraseAuth(ERASE_ALL_SCOPE, async (_req, address) => {
  await eraseSecrets(address);
  return NextResponse.json({ ok: true });
});
