import { NextRequest, NextResponse } from 'next/server';

import { validateSiweCredentials } from '@/lib/siwe';
import { linkIdentity, ConflictEncryptedDataError, AlreadyLinkedError } from '@/controllers/identities';
import { RouteAuthError, authenticateRequest } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // `authenticateRequest`, not `getServerSession`: the latter only decodes the
  // JWT, so a revoked device could still attach a new sign-in method to the
  // account it had just been thrown out of.
  let userId: string;
  try {
    ({ userId } = await authenticateRequest(req));
  } catch (err) {
    if (err instanceof RouteAuthError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  const body = (await req.json()) as { message?: string; signature?: string };

  if (!body.message || !body.signature) {
    return NextResponse.json({ error: 'Missing message or signature' }, { status: 400 });
  }

  const valid = await validateSiweCredentials(body.message, body.signature);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid SIWE credentials' }, { status: 400 });
  }

  const addressLower = valid.address.toLowerCase();

  try {
    await linkIdentity(userId, 'siwe', addressLower, {
      rawProfileJson: { addressLower, addressChecksum: valid.address },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ConflictEncryptedDataError) {
      return NextResponse.json({ error: 'CONFLICT_ENCRYPTED_DATA' }, { status: 409 });
    }
    if (err instanceof AlreadyLinkedError) {
      return NextResponse.json({ error: 'ALREADY_LINKED' }, { status: 409 });
    }
    throw err;
  }
}
