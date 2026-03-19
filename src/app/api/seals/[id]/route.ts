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
import { assertOwner, withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { address, params: { id } }) => {
  assertOwner(await getSealById(id), address);

  await deleteSeal(id);

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { address, params: { id } }) => {
  const seal = assertOwner(await getSealById(id), address);

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
    updated = await updateSealColor(id, color ?? null);
  } else if (typeof position === 'number') {
    updated = await updateSealPosition(id, position);
  } else {
    updated = await updateSeal(id, {
      title: title !== undefined ? title : seal.title,
      encryptedBody: encryptedBody !== undefined ? encryptedBody : seal.encryptedBody,
      wrappedNoteKey: wrappedNoteKey !== undefined ? wrappedNoteKey : seal.wrappedNoteKey,
    });
  }

  return NextResponse.json(updated);
});
