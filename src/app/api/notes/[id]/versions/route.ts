import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getNoteById } from '@/controllers/notes';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

// Returns the full embedded version history (oldest → newest). The fetch already
// loads the array off the parent doc, so there's no win in a metadata-only shape.
export const GET = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const note = assertOwner(await getNoteById(id), userId);
  return NextResponse.json(note.versions ?? []);
});
