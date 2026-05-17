import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { deleteSecret, getSecretById, secretOps, updateSecret } from '@/controllers/secrets';
import { linkFilesToNote, softDeleteFilesByNoteId } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';
import { handleCommonPatch } from '@/app/api/_shared/noteRouteHelpers';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSecretById(id), userId);

  await deleteSecret(id);
  await softDeleteFilesByNoteId(id);

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const secret = assertOwner(await getSecretById(id), userId);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await handleCommonPatch(id, userId, body, secretOps);
  if (result.handled) {
    return 'response' in result ? result.response : NextResponse.json(result.updated);
  }

  const { title, encryptedBody, fileIds } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload | null;
    fileIds?: string[];
  };
  if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const updated = await updateSecret(
    id,
    title ?? secret.title,
    encryptedBody !== undefined ? encryptedBody : secret.encryptedBody,
  );
  if (Array.isArray(fileIds) && fileIds.length) {
    await linkFilesToNote(userId, id, 'secret', fileIds);
  }

  return NextResponse.json(updated);
});
