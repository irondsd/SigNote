import { encode } from 'next-auth/jwt';
import { getOrCreateGoogleUserId } from '../fixtures/getOrCreateGoogleUserId';

const SECRET = process.env.NEXTAUTH_SECRET ?? 'test-secret';

export const createGoogleTestSession = async (googleId: string, email: string): Promise<string> => {
  const userId = await getOrCreateGoogleUserId(googleId, email);
  return encode({
    token: { sub: userId, name: email },
    secret: SECRET,
    maxAge: 7 * 24 * 60 * 60,
  });
};
