import { encode } from 'next-auth/jwt';
import { v7 as uuidv7 } from 'uuid';
import { getOrCreateGoogleUserId } from '../fixtures/getOrCreateGoogleUserId';

const SECRET = process.env.NEXTAUTH_SECRET ?? 'test-secret';

export const createGoogleTestSession = async (googleId: string, email: string): Promise<string> => {
  const userId = await getOrCreateGoogleUserId(googleId, email);
  // sid mirrors what the production jwt callback writes on real sign-in. A token
  // without one is a pre-sessions JWT, which `authenticateRequest` now rejects
  // outright because nothing can ever revoke it.
  const sid = uuidv7();
  return encode({
    token: { sub: userId, name: email, sid, provider: 'google', client: 'web' },
    secret: SECRET,
    maxAge: 7 * 24 * 60 * 60,
  });
};
