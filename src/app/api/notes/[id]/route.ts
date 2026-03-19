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
import { assertOwner, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { address, params: { id } }) => {
  const note = assertOwner(await getNoteById(id), address);

  await deleteNote(note._id.toString());

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { address, params: { id } }) => {
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
    updated = await updateNoteColor(id, color ?? null);
  } else if (typeof position === 'number') {
    updated = await updateNotePosition(id, position);
  } else {
    updated = await updateNote(id, title ?? note.title, content ?? note.content);
  }

  return NextResponse.json(updated);
});
