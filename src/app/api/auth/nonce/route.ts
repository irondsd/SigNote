import { attachDatabasePool } from '@vercel/functions';
import { type NextRequest, NextResponse } from 'next/server';
import { generateNonce } from 'siwe';

import { checkNonceRateLimit, createNonceRecord } from '@/controllers/nonces';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : undefined;

  if (ip) {
    const allowed = await checkNonceRateLimit(ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
  }

  const nonce = generateNonce();
  await createNonceRecord(nonce, ip);

  return NextResponse.json({ nonce });
}
