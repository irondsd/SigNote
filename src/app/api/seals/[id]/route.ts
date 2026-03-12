import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

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
import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { type EncryptedPayload } from '@/types/crypto';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address;

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const seal = await getSealById(id);
  if (!seal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (seal.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await deleteSeal(id);

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address;

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const seal = await getSealById(id);
  if (!seal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (seal.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
}
