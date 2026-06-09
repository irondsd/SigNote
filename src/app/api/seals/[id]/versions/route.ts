import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getSealById } from '@/controllers/seals';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

// Returns the full embedded version history (oldest → newest). Bodies are
// ciphertext; the client unwraps the head's note key to decrypt each.
export const GET = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const seal = assertOwner(await getSealById(id), userId);
  return NextResponse.json(seal.versions ?? []);
});
