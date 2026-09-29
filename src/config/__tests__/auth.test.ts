jest.mock('@/controllers/authSessions', () => ({
  captureSessionEpoch: jest.fn(),
  revokeSessionBySid: jest.fn(),
}));
jest.mock('@/controllers/users', () => ({ upsertGoogleUser: jest.fn() }));

import { captureSessionEpoch } from '@/controllers/authSessions';
import { upsertGoogleUser } from '@/controllers/users';
import { authOptions } from '@/config/auth';

const mockCaptureSessionEpoch = captureSessionEpoch as jest.MockedFunction<typeof captureSessionEpoch>;
const mockUpsertGoogleUser = upsertGoogleUser as jest.MockedFunction<typeof upsertGoogleUser>;

// The NextAuth callback type is intentionally broad because it accepts the
// provider-specific account/user shapes. Keep the test inputs small and model
// only the fields this callback consumes.
const invokeJwt = async (input: Record<string, unknown>) => {
  const callback = authOptions.callbacks?.jwt;
  if (!callback) throw new Error('jwt callback missing');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return callback(input as any);
};

beforeEach(() => {
  mockCaptureSessionEpoch.mockReset();
  mockCaptureSessionEpoch.mockResolvedValue(7);
  mockUpsertGoogleUser.mockReset();
});

it('redirects a failed Google database lookup to a safe error code', async () => {
  const callback = authOptions.callbacks?.signIn;
  if (!callback) throw new Error('signIn callback missing');
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockUpsertGoogleUser.mockRejectedValueOnce(new Error('Failed query:\nparams: google,subject,1'));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await callback({ account: { provider: 'google' }, profile: { sub: 'subject' } } as any);
    expect(result).toBe('/auth/error?error=Callback');
    expect(log).toHaveBeenCalledWith('[auth] Google sign-in failed:', expect.any(Error));
  } finally {
    log.mockRestore();
  }
});

describe('NextAuth session epoch claims', () => {
  it('binds Google tokens to the application user id and captures the epoch once', async () => {
    const token = await invokeJwt({
      token: {},
      account: { provider: 'google', userId: 'application-user', displayName: 'App user' },
      // OAuth provider subject; this must not replace account.userId.
      user: { id: 'google-subject', client: 'web' },
    });

    expect(token.sub).toBe('application-user');
    expect(token.sessionEpoch).toBe(7);
    expect(token.sid).toEqual(expect.any(String));
    expect(mockCaptureSessionEpoch).toHaveBeenCalledWith('application-user', token.sid);
  });

  it('does not upgrade the immutable epoch on refresh', async () => {
    const first = await invokeJwt({
      token: {},
      account: { provider: 'credentials' },
      user: { id: 'application-user', client: 'web' },
    });
    mockCaptureSessionEpoch.mockResolvedValue(8);

    const refreshed = await invokeJwt({ token: first });

    expect(refreshed).toMatchObject({
      sub: 'application-user',
      sid: first.sid,
      sessionEpoch: 7,
    });
    expect(mockCaptureSessionEpoch).toHaveBeenCalledTimes(1);
  });
});
