import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { createNote, getNotesByAddress } from '@/controllers/notes';
import { authOptions } from '@/utils/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address;
  const archived = req.nextUrl.searchParams.get('archived') === 'true';
  const limit = Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30);
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim();

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const notes = await getNotesByAddress(address, archived, limit, offset, search);

  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address;

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { title, content } = body as { title?: string; content?: string };

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const note = await createNote(address, title ?? '', content ?? '');

  return NextResponse.json(note, { status: 201 });
}
