import { encode } from 'next-auth/jwt';
import type { Address } from 'viem';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';

const SECRET = process.env.NEXTAUTH_SECRET ?? 'test-secret';

export const createTestSession = async (address: Address): Promise<string> => {
  const userId = await getOrCreateUserId(address);
  return encode({
    token: { sub: userId, name: address },
    secret: SECRET,
    maxAge: 7 * 24 * 60 * 60,
  });
};
