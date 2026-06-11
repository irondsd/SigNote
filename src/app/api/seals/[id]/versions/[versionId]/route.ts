import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { deleteSealVersion, getSealById } from '@/controllers/seals';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

// Removes a single version from history. Idempotent — deleting an id that's
// already gone still succeeds.
export const DELETE = withSession(async (_req, { userId, params: { id, versionId } }) => {
  if (!isValidObjectId(id) || !isValidObjectId(versionId)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getSealById(id), userId);

  const updated = await deleteSealVersion(id, versionId);
  if (!updated) throw new RouteAuthError(404, 'Not found');

  return NextResponse.json({ success: true });
});
