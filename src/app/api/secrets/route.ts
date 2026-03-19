import { NextResponse } from 'next/server';

import { createSecret, getSecretsByAddress } from '@/controllers/secrets';
import { withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { address }) => {
  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30);
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim();

  const secrets = await getSecretsByAddress(address, archived, limit, offset, search);

  return NextResponse.json(secrets);
});

export const POST = withSession(async (req, { address }) => {
  const body = await req.json();
  const { title, encryptedBody } = body as { title?: string; encryptedBody?: EncryptedPayload };

  const secret = await createSecret(address, title ?? '', encryptedBody ?? null);

  return NextResponse.json(secret, { status: 201 });
});
