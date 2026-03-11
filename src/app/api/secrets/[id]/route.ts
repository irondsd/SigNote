import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

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
import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { type EncryptedPayload } from '@/models/EncryptionProfile';

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

  const secret = await getSecretById(id);
  if (!secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (secret.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await deleteSecret(id);

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

  const secret = await getSecretById(id);
  if (!secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (secret.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
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
    updated = await updateSecretColor(id, color ?? null);
  } else if (typeof position === 'number') {
    updated = await updateSecretPosition(id, position);
  } else {
    updated = await updateSecret(id, title ?? secret.title, encryptedBody !== undefined ? encryptedBody : secret.encryptedBody);
  }

  return NextResponse.json(updated);
}
