import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getSecretById, restoreSecretVersion } from '@/controllers/secrets';
import { linkFilesToNote } from '@/controllers/files';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const POST = withSession(async (req, { userId, params: { id, versionId } }) => {
  if (!isValidObjectId(id) || !isValidObjectId(versionId)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSecretById(id), userId);

  const updated = await restoreSecretVersion(id, versionId);
  if (!updated) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  // The body is encrypted, so file references can't be parsed server-side; the
  // client decrypts the version and reports its file ids for re-linking.
  let fileIds: string[] | undefined;
  try {
    ({ fileIds } = (await req.json()) as { fileIds?: string[] });
  } catch {
    // No body is fine — nothing to re-link.
  }
  if (Array.isArray(fileIds) && fileIds.length) await linkFilesToNote(userId, id, 'secret', fileIds);

  return NextResponse.json(updated);
});
