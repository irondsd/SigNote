import { NextResponse } from 'next/server';

import { createSecret, getSecretsByUserId } from '@/controllers/secrets';
import { withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_SEARCH, MAX_TITLE } from '@/config/constants';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { userId }) => {
  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30));
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, MAX_SEARCH);

  const secrets = await getSecretsByUserId(userId, archived, limit, offset, search);

  return NextResponse.json(secrets);
});

export const POST = withSession(async (req, { userId }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { title, encryptedBody } = body as { title?: string; encryptedBody?: EncryptedPayload };

  if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const secret = await createSecret(userId, title ?? '', encryptedBody ?? null);

  return NextResponse.json(secret, { status: 201 });
});
