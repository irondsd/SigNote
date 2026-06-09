import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getSealById, restoreSealVersion } from '@/controllers/seals';
import { linkFilesToNote } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const POST = withSession(async (req, { userId, params: { id, versionId } }) => {
  if (!isValidObjectId(id) || !isValidObjectId(versionId)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSealById(id), userId);

  const updated = await restoreSealVersion(id, versionId);
  if (!updated) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  // Encrypted body — the client decrypts the version and reports file ids.
  let fileIds: string[] | undefined;
  try {
    ({ fileIds } = (await req.json()) as { fileIds?: string[] });
  } catch {
    // No body is fine — nothing to re-link.
  }
  if (Array.isArray(fileIds) && fileIds.length) await linkFilesToNote(userId, id, 'seal', fileIds);

  return NextResponse.json(updated);
});
