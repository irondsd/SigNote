import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getNoteVersions } from '@/controllers/notes';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

// Returns the full embedded version history (oldest → newest). This is the only
// endpoint that ships versions — head reads and write responses strip them.
export const GET = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const note = assertOwner(await getNoteVersions(id), userId);
  return NextResponse.json(note.versions ?? []);
});
