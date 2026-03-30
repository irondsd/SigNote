import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { ERASE_ENCRYPTION_SCOPE, issueEraseToken } from '@/lib/eraseAuth';

export const runtime = 'nodejs';

export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = issueEraseToken(userId, ERASE_ENCRYPTION_SCOPE);
  return NextResponse.json({ token });
}
