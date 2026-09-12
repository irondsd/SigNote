import { encode } from 'next-auth/jwt';
import { v7 as uuidv7 } from 'uuid';
import type { Address } from 'viem';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { captureSessionEpoch } from '../../src/controllers/authSessions';

const SECRET = process.env.NEXTAUTH_SECRET ?? 'test-secret';

export const createTestSession = async (address: Address): Promise<string> => {
  const userId = await getOrCreateUserId(address);
  // sid, provider and epoch mirror what the production jwt callback writes on a
  // real sign-in, so every test exercises the per-request session validation
  // path. The epoch matters once an account has ever revoked its other sessions:
  // from then on a token without one is rejected, exactly as a legacy token is,
  // so an injected session that skipped this could not sign in again afterwards.
  const sid = uuidv7();
  const sessionEpoch = await captureSessionEpoch(userId, sid);
  return encode({
    token: { sub: userId, name: address, sid, provider: 'siwe', sessionEpoch },
    secret: SECRET,
    maxAge: 7 * 24 * 60 * 60,
  });
};
