import mongoose from 'mongoose';
import { encode } from 'next-auth/jwt';
import type { Address } from 'viem';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';

const SECRET = process.env.NEXTAUTH_SECRET ?? 'test-secret';

export const createTestSession = async (address: Address): Promise<string> => {
  const userId = await getOrCreateUserId(address);
  // sid + provider mirror what the production jwt callback writes on real sign-in,
  // so every test exercises the per-request session validation path.
  const sid = new mongoose.Types.ObjectId().toString();
  return encode({
    token: { sub: userId, name: address, sid, provider: 'siwe' },
    secret: SECRET,
    maxAge: 7 * 24 * 60 * 60,
  });
};
