import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';

import { authOptions } from '@/config/auth';
import { consumeNonceRecord } from '@/controllers/nonces';
import { ERASE_ALL_SCOPE, issueEraseToken } from '@/lib/eraseAuth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const sessionAddress = session?.user?.address;

  if (!userId || !sessionAddress) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const { message, signature } = await req.json().catch(() => ({}));

  if (!message || !signature) {
    return NextResponse.json({ error: 'Missing message or signature' }, { status: 400 });
  }

  try {
    const siwe = new SiweMessage(message);

    if (siwe.address.toLowerCase() !== sessionAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Address mismatch' }, { status: 403 });
    }

    const result = await siwe.verify({ signature });

    if (!result.success || !result.data?.nonce) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const consumed = await consumeNonceRecord(result.data.nonce);
    if (!consumed) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 400 });
    }

    // Verify the statement contains the erase-all scope marker
    const expectedStatement = `By signing this message I agree to erase all data associated with account ${sessionAddress}`;
    if (!siwe.statement?.includes(expectedStatement)) {
      return NextResponse.json({ error: 'Invalid statement scope' }, { status: 400 });
    }

    const token = issueEraseToken(userId, ERASE_ALL_SCOPE);
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
  }
}
