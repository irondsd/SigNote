import jwt from 'jsonwebtoken';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { attachDatabasePool } from '@vercel/functions';

export const ERASE_ALL_SCOPE = 'erase-all';
export const ERASE_ENCRYPTION_SCOPE = 'erase-encryption';

export interface EraseTokenPayload {
  userId: string;
  scope: string;
}

export function issueEraseToken(userId: string, scope: string): string {
  return jwt.sign({ userId, scope }, process.env.NEXTAUTH_SECRET!, {
    expiresIn: '15m',
  });
}

type EraseHandler = (req: NextRequest, userId: string) => Promise<NextResponse>;

export function withEraseAuth(
  expectedScope: string | string[],
  handler: EraseHandler,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: 'Missing erase token' }, { status: 401 });
    }

    let payload: EraseTokenPayload;
    try {
      payload = jwt.verify(token, process.env.NEXTAUTH_SECRET!) as EraseTokenPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid or expired erase token' }, { status: 401 });
    }

    const validScopes = Array.isArray(expectedScope) ? expectedScope : [expectedScope];
    if (!validScopes.includes(payload.scope)) {
      return NextResponse.json({ error: 'Invalid token scope' }, { status: 403 });
    }

    if (payload.userId !== userId) {
      return NextResponse.json({ error: 'Token user mismatch' }, { status: 403 });
    }

    const client = await getMongoClientFromMongoose();
    attachDatabasePool(client);

    return handler(req, userId);
  };
}
