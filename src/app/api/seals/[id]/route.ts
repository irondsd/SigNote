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
  updateSealPattern,
  updateSealPosition,
} from '@/controllers/seals';
import { linkFilesToNote, softDeleteFilesByNoteId, restoreFilesByNoteId } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';
import { type EncryptedPayload } from '@/types/crypto';
import { MAX_CIPHER, MAX_TITLE } from '@/config/constants';

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
  const { title, encryptedBody, wrappedNoteKey, archived, deleted, color, pattern, position, fileIds } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload | null;
    wrappedNoteKey?: EncryptedPayload | null;
    archived?: boolean;
    deleted?: boolean;
    color?: string | null;
    pattern?: string | null;
    position?: number;
    fileIds?: string[];
  };

  let updated;
  if (typeof deleted === 'boolean') {
    if (deleted) {
      updated = await deleteSeal(id);
      await softDeleteFilesByNoteId(id);
    } else {
      updated = await undeleteSeal(id);
      await restoreFilesByNoteId(id, userId);
    }
  } else if (typeof archived === 'boolean') {
    updated = archived ? await archiveSeal(id) : await unarchiveSeal(id);
  } else if ('color' in body) {
    if (color !== null && !NOTE_COLORS.includes(color as NoteColor)) {
      return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    }
    updated = await updateSealColor(id, color ?? null);
  } else if ('pattern' in body) {
    if (pattern !== null && !NOTE_PATTERNS.includes(pattern as NotePattern)) {
      return NextResponse.json({ error: 'Invalid pattern' }, { status: 400 });
    }
    updated = await updateSealPattern(id, pattern ?? null);
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
    if (Array.isArray(fileIds) && fileIds.length) {
      await linkFilesToNote(userId, id, 'seal', fileIds);
    }
  }

  return NextResponse.json(updated);
});
