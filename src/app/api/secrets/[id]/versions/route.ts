import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { getSecretVersions } from '@/controllers/secrets';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

// Returns the full embedded version history (oldest → newest). Bodies are
// ciphertext; the client decrypts each with the shared session key. This is the
// only endpoint that ships versions — head reads and write responses strip them.
export const GET = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  const secret = assertOwner(await getSecretVersions(id), userId);
  return NextResponse.json(secret.versions ?? []);
});
