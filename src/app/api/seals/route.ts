import { NextResponse } from 'next/server';

import { createSeal, getSealsByUserId } from '@/controllers/seals';
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

  const seals = await getSealsByUserId(userId, archived, limit, offset, search);

  return NextResponse.json(seals);
});

export const POST = withSession(async (req, { userId }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { title, encryptedBody, wrappedNoteKey, color } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload;
    wrappedNoteKey?: EncryptedPayload;
    color?: string | null;
  };

  if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // encryptedBody and wrappedNoteKey are optional for 2-step creation flow
  const seal = await createSeal(userId, title ?? '', encryptedBody ?? null, wrappedNoteKey ?? null, color);

  return NextResponse.json(seal, { status: 201 });
});
