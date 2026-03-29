import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import {
  archiveSeal,
  deleteSeal,
  getSealById,
  unarchiveSeal,
  undeleteSeal,
  updateSeal,
  updateSealColor,
  updateSealPosition,
} from '@/controllers/seals';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSealById(id), userId);

  await deleteSeal(id);

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const seal = assertOwner(await getSealById(id), userId);

  const body = await req.json();
  const { title, encryptedBody, wrappedNoteKey, archived, deleted, color, position } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload | null;
    wrappedNoteKey?: EncryptedPayload | null;
    archived?: boolean;
    deleted?: boolean;
    color?: string | null;
    position?: number;
  };

  let updated;
  if (typeof deleted === 'boolean') {
    updated = deleted ? await deleteSeal(id) : await undeleteSeal(id);
  } else if (typeof archived === 'boolean') {
    updated = archived ? await archiveSeal(id) : await unarchiveSeal(id);
  } else if ('color' in body) {
    if (color !== null && !NOTE_COLORS.includes(color as NoteColor)) {
      return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    }
    updated = await updateSealColor(id, color ?? null);
  } else if (typeof position === 'number') {
    if (!Number.isFinite(position)) {
      return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
    }
    updated = await updateSealPosition(id, position);
  } else {
    if ((title?.length ?? 0) > MAX_TITLE || (encryptedBody?.ciphertext?.length ?? 0) > MAX_CIPHER) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    updated = await updateSeal(id, {
      title: title !== undefined ? title : seal.title,
      encryptedBody: encryptedBody !== undefined ? encryptedBody : seal.encryptedBody,
      wrappedNoteKey: wrappedNoteKey !== undefined ? wrappedNoteKey : seal.wrappedNoteKey,
    });
  }

  return NextResponse.json(updated);
});
