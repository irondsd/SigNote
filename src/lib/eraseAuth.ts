import jwt from 'jsonwebtoken';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { type Address } from 'viem';

import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { attachDatabasePool } from '@vercel/functions';

export const ERASE_ALL_SCOPE = 'erase-all';

export interface EraseTokenPayload {
  address: string;
  scope: string;
}

export function issueEraseToken(address: Address, scope: string): string {
  return jwt.sign({ address: address.toLowerCase(), scope }, process.env.NEXTAUTH_SECRET!, {
    expiresIn: '15m',
  });
}

type EraseHandler = (req: NextRequest, address: Address) => Promise<NextResponse>;

export function withEraseAuth(
  expectedScope: string,
  handler: EraseHandler,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => {
    const session = await getServerSession(authOptions);
    const sessionAddress = session?.user?.address as Address | undefined;

    if (!sessionAddress) {
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

    if (payload.scope !== expectedScope) {
      return NextResponse.json({ error: 'Invalid token scope' }, { status: 403 });
    }

    if (payload.address !== sessionAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Token address mismatch' }, { status: 403 });
    }

    const client = await getMongoClientFromMongoose();
    attachDatabasePool(client);

    return handler(req, sessionAddress);
  };
}
