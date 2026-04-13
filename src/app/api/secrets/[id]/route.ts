import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import {
  archiveSecret,
  deleteSecret,
  getSecretById,
  unarchiveSecret,
  undeleteSecret,
  updateSecret,
  updateSecretColor,
  updateSecretPosition,
} from '@/controllers/secrets';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSecretById(id), userId);

  await deleteSecret(id);

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
  const { title, encryptedBody, archived, deleted, color, position } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload | null;
    archived?: boolean;
    deleted?: boolean;
    color?: string | null;
    position?: number;
  };

  let updated;
  if (typeof deleted === 'boolean') {
    updated = deleted ? await deleteSecret(id) : await undeleteSecret(id);
  } else if (typeof archived === 'boolean') {
    updated = archived ? await archiveSecret(id) : await unarchiveSecret(id);
  } else if ('color' in body) {
    if (color !== null && !NOTE_COLORS.includes(color as NoteColor)) {
      return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    }
    updated = await updateSecretColor(id, color ?? null);
  } else if (typeof position === 'number') {
    if (!Number.isFinite(position)) {
      return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
    }
    updated = await updateSecretPosition(id, position);
  } else {
    if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    updated = await updateSecret(
      id,
      title ?? secret.title,
      encryptedBody !== undefined ? encryptedBody : secret.encryptedBody,
    );
  }

  return NextResponse.json(updated);
});
