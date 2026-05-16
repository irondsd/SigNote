import { NextResponse } from 'next/server';

import { createNote, getNotesByUserId } from '@/controllers/notes';
import { linkFilesToNote } from '@/controllers/files';
import { withSession } from '@/lib/routeAuth';
import { MAX_CONTENT, MAX_SEARCH, MAX_TITLE } from '@/config/constants';
import { extractFileIds } from '@/lib/fileIds';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { userId }) => {
  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30));
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, MAX_SEARCH);

  const notes = await getNotesByUserId(userId, archived, limit, offset, search);

  return NextResponse.json(notes);
});

export const POST = withSession(async (req, { userId }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { title, content, color, pattern } = body as { title?: string; content?: string; color?: string | null; pattern?: string | null };

  if ((title?.length ?? 0) > MAX_TITLE || (content?.length ?? 0) > MAX_CONTENT) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const note = await createNote(userId, title ?? '', content ?? '', color, pattern);

  const fileIds = extractFileIds(content ?? '');
  if (fileIds.length) {
    await linkFilesToNote(userId, note._id.toString(), 'note', fileIds);
  }

  return NextResponse.json(note, { status: 201 });
});
