import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import {
  archiveNote,
  deleteNote,
  getNoteById,
  unarchiveNote,
  undeleteNote,
  updateNote,
  updateNoteColor,
  updateNotePosition,
} from '@/controllers/notes';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { MAX_CONTENT, MAX_TITLE } from '@/config/constants';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { address, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const note = assertOwner(await getNoteById(id), address);

  await deleteNote(note._id.toString());

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { address, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const note = assertOwner(await getNoteById(id), address);

  const body = await req.json();
  const { title, content, archived, deleted, color, position } = body as {
    title?: string;
    content?: string;
    archived?: boolean;
    deleted?: boolean;
    color?: string | null;
    position?: number;
  };

  let updated;
  if (typeof deleted === 'boolean') {
    updated = deleted ? await deleteNote(id) : await undeleteNote(id);
  } else if (typeof archived === 'boolean') {
    updated = archived ? await archiveNote(id) : await unarchiveNote(id);
  } else if ('color' in body) {
    if (color !== null && !NOTE_COLORS.includes(color as NoteColor)) {
      return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    }
    updated = await updateNoteColor(id, color ?? null);
  } else if (typeof position === 'number') {
    if (!Number.isFinite(position)) {
      return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
    }
    updated = await updateNotePosition(id, position);
  } else {
    if ((title?.length ?? 0) > MAX_TITLE || (content?.length ?? 0) > MAX_CONTENT) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    updated = await updateNote(id, title ?? note.title, content ?? note.content);
  }

  return NextResponse.json(updated);
});
