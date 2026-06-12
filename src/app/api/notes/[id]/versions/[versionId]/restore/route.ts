import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getNoteById, restoreNoteVersion } from '@/controllers/notes';
import { linkFilesToNote } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';
import { extractFileIds } from '@/lib/fileIds';

export const runtime = 'nodejs';

export const POST = withSession(async (_req, { userId, params: { id, versionId } }) => {
  if (!isValidObjectId(id) || !isValidObjectId(versionId)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getNoteById(id), userId);

  const updated = await restoreNoteVersion(id, versionId);
  if (!updated) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  // Re-link any file references that live in the restored content.
  const fileIds = extractFileIds(updated.content);
  if (fileIds.length) await linkFilesToNote(userId, id, 'note', fileIds);

  return NextResponse.json(updated);
});
