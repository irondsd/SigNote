import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { deleteSeal, getSealById, sealOps, updateSeal } from '@/controllers/seals';
import { linkFilesToNote, softDeleteFilesByNoteId } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';
import { handleCommonPatch } from '@/app/api/_shared/noteRouteHelpers';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSealById(id), userId);

  await deleteSeal(id);
  await softDeleteFilesByNoteId(id);

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const seal = assertOwner(await getSealById(id), userId);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await handleCommonPatch(id, userId, body, sealOps);
  if (result.handled) {
    return 'response' in result ? result.response : NextResponse.json(result.updated);
  }

  const { title, encryptedBody, wrappedNoteKey, fileIds } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload | null;
    wrappedNoteKey?: EncryptedPayload | null;
    fileIds?: string[];
  };
  if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const updated = await updateSeal(id, {
    title: title !== undefined ? title : seal.title,
    encryptedBody: encryptedBody !== undefined ? encryptedBody : seal.encryptedBody,
    wrappedNoteKey: wrappedNoteKey !== undefined ? wrappedNoteKey : seal.wrappedNoteKey,
  });
  if (Array.isArray(fileIds) && fileIds.length) {
    await linkFilesToNote(userId, id, 'seal', fileIds);
  }

  return NextResponse.json(updated);
});
