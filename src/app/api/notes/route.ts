import { NextResponse } from 'next/server';

import { createNote, getNotesByAddress } from '@/controllers/notes';
import { withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { address }) => {
  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30);
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim();

  const notes = await getNotesByAddress(address, archived, limit, offset, search);

  return NextResponse.json(notes);
});

export const POST = withSession(async (req, { address }) => {
  const body = await req.json();
  const { title, content } = body as { title?: string; content?: string };

  const note = await createNote(address, title ?? '', content ?? '');

  return NextResponse.json(note, { status: 201 });
});
