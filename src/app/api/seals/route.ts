import { NextResponse } from 'next/server';

import { createSeal, getSealsByUserId } from '@/controllers/seals';
import { linkFilesToNote } from '@/controllers/files';
import { touchTags } from '@/controllers/tags';
import { withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';
import { parseListParams, resolveCreateTags } from '@/app/api/_shared/noteRouteHelpers';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { userId }) => {
  const { archived, limit, offset, search, tagIds, tagMode } = parseListParams(req);
  const seals = await getSealsByUserId(userId, archived, limit, offset, search, tagIds, tagMode);
  return NextResponse.json(seals);
});

export const POST = withSession(async (req, { userId }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { title, encryptedBody, wrappedNoteKey, color, pattern, fileIds, tags } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload;
    wrappedNoteKey?: EncryptedPayload;
    color?: string | null;
    pattern?: string | null;
    fileIds?: string[];
    tags?: string[];
  };

  if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const { tagIds, error: tagError } = await resolveCreateTags(userId, tags);
  if (tagError) return tagError;
  // encryptedBody and wrappedNoteKey are optional for 2-step creation flow
  const seal = await createSeal(userId, title ?? '', encryptedBody ?? null, wrappedNoteKey ?? null, color, pattern, tagIds);
  if (tagIds?.length) await touchTags(tagIds);

  if (Array.isArray(fileIds) && fileIds.length) {
    await linkFilesToNote(userId, seal._id.toString(), 'seal', fileIds);
  }

  return NextResponse.json(seal, { status: 201 });
});
