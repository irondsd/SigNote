import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { deleteNote, getNoteById, noteOps, updateNote } from '@/controllers/notes';
import { linkFilesToNote, softDeleteFilesByNoteId } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { MAX_CONTENT, MAX_TITLE } from '@/config/constants';
import { extractFileIds } from '@/lib/fileIds';
import { handleCommonPatch } from '@/app/api/_shared/noteRouteHelpers';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const note = assertOwner(await getNoteById(id), userId);

  await deleteNote(note._id.toString());
  await softDeleteFilesByNoteId(id);

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const note = assertOwner(await getNoteById(id), userId);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await handleCommonPatch(id, userId, body, noteOps);
  if (result.handled) {
    return 'response' in result ? result.response : NextResponse.json(result.updated);
  }

  const { title, content } = body as { title?: string; content?: string };
  if ((title?.length ?? 0) > MAX_TITLE || (content?.length ?? 0) > MAX_CONTENT) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const updated = await updateNote(id, title ?? note.title, content ?? note.content);
  if (content !== undefined) {
    const fileIds = extractFileIds(content);
    if (fileIds.length) await linkFilesToNote(userId, id, 'note', fileIds);
  }

  return NextResponse.json(updated);
});
