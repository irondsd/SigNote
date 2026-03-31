import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { validateSiweCredentials } from '@/lib/siwe';
import { linkIdentity, ConflictEncryptedDataError, AlreadyLinkedError } from '@/controllers/identities';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { message?: string; signature?: string };

  if (!body.message || !body.signature) {
    return NextResponse.json({ error: 'Missing message or signature' }, { status: 400 });
  }

  const valid = await validateSiweCredentials(body.message, body.signature);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid SIWE credentials' }, { status: 400 });
  }

  const addressLower = valid.address.toLowerCase();

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  try {
    await linkIdentity(userId, 'siwe', addressLower, {
      rawProfileJson: { addressLower, addressChecksum: valid.address },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ConflictEncryptedDataError) {
      return NextResponse.json({ error: 'CONFLICT_ENCRYPTED_DATA' }, { status: 409 });
    }
    if (err instanceof AlreadyLinkedError) {
      return NextResponse.json({ error: 'ALREADY_LINKED' }, { status: 409 });
    }
    throw err;
  }
}
