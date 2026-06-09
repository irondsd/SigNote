import { NextResponse } from 'next/server';

import { createSecret, getSecretsByUserId } from '@/controllers/secrets';
import { linkFilesToNote } from '@/controllers/files';
import { getOwnedTagIds, touchTags } from '@/controllers/tags';
import { withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';
import { parseListParams } from '@/app/api/_shared/noteRouteHelpers';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { userId }) => {
  const { archived, limit, offset, search, tagIds, tagMode } = parseListParams(req);
  const secrets = await getSecretsByUserId(userId, archived, limit, offset, search, tagIds, tagMode);
  return NextResponse.json(secrets);
});

export const POST = withSession(async (req, { userId }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { title, encryptedBody, color, pattern, fileIds, tags } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload;
    color?: string | null;
    pattern?: string | null;
    fileIds?: string[];
    tags?: string[];
  };

  if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const tagIds = Array.isArray(tags) ? await getOwnedTagIds(userId, tags.filter((t) => typeof t === 'string')) : undefined;
  const secret = await createSecret(userId, title ?? '', encryptedBody ?? null, color, pattern, tagIds);
  if (tagIds?.length) await touchTags(tagIds);

  if (Array.isArray(fileIds) && fileIds.length) {
    await linkFilesToNote(userId, secret._id.toString(), 'secret', fileIds);
  }

  return NextResponse.json(secret, { status: 201 });
});
