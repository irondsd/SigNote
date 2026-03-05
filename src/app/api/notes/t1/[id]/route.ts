import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { archiveNote, deleteNote, getNoteById, unarchiveNote, undeleteNote, updateNote } from '@/controllers/notes';
import { authOptions } from '@/utils/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

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

  const note = await getNoteById(id);
  if (!note) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (note.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await deleteNote(id);

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

  const note = await getNoteById(id);
  if (!note) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (note.address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { title, content, archived, deleted } = body as {
    title?: string;
    content?: string;
    archived?: boolean;
    deleted?: boolean;
  };

  let updated;
  if (typeof deleted === 'boolean') {
    updated = deleted ? await deleteNote(id) : await undeleteNote(id);
  } else if (typeof archived === 'boolean') {
    updated = archived ? await archiveNote(id) : await unarchiveNote(id);
  } else {
    updated = await updateNote(id, title ?? note.title, content ?? note.content);
  }

  return NextResponse.json(updated);
}
