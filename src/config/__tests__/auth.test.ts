jest.mock('@/controllers/authSessions', () => ({
  captureSessionEpoch: jest.fn(),
  revokeSessionBySid: jest.fn(),
}));

import { captureSessionEpoch } from '@/controllers/authSessions';
import { authOptions } from '@/config/auth';

const mockCaptureSessionEpoch = captureSessionEpoch as jest.MockedFunction<typeof captureSessionEpoch>;

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
