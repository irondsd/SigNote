import { attachDatabasePool } from '@vercel/functions';
import { NextResponse } from 'next/server';
import { generateNonce } from 'siwe';

import { createNonceRecord, ensureNonceIndexes } from '@/lib/auth-db';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function GET() {
  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  await ensureNonceIndexes();

  const nonce = generateNonce();
  await createNonceRecord(nonce);

  return NextResponse.json({ nonce });
}
