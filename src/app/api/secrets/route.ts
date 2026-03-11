import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { createSecret, getSecretsByAddress } from '@/controllers/secrets';
import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { type Address } from 'viem';
import { type EncryptedPayload } from '@/models/EncryptionProfile';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address as Address;

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30);
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim();

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const secrets = await getSecretsByAddress(address, archived, limit, offset, search);

  return NextResponse.json(secrets);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address as Address;

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { title, encryptedBody } = body as { title?: string; encryptedBody?: EncryptedPayload };

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const secret = await createSecret(address, title ?? '', encryptedBody ?? null);

  return NextResponse.json(secret, { status: 201 });
}
