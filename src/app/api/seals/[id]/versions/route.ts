import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getSealVersions } from '@/controllers/seals';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

// Returns the full embedded version history (oldest → newest). Bodies are
// ciphertext; the client unwraps the head's note key to decrypt each. This is
// the only endpoint that ships versions — head reads and write responses strip
// them.
export const GET = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const seal = assertOwner(await getSealVersions(id), userId);
  return NextResponse.json(seal.versions ?? []);
});
