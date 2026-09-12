const nextAuthHandler = jest.fn(async () => NextResponse.json({ user: { id: 'u1' } }));

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn(() => nextAuthHandler) }));
jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));
jest.mock('@/config/auth', () => ({ authOptions: {} }));
jest.mock('@/controllers/authSessions', () => ({
  TOUCH_THROTTLE_MS: 5 * 60 * 1000,
  findSessionForValidation: jest.fn(),
  isSessionEpochAllowed: (
    state: { sessionEpoch: number; survivingSid: string | null },
    sid: string,
    epoch: number | null | undefined,
  ) =>
    epoch !== null &&
    (state.survivingSid === sid || (epoch === undefined ? state.sessionEpoch === 0 : epoch === state.sessionEpoch)),
  SessionEpochError: class SessionEpochError extends Error {},
  touchSession: jest.fn(),
  upsertSessionIfMissing: jest.fn(),
}));
jest.mock('@/db/encryptionState', () => ({
  VaultConflictError: class VaultConflictError extends Error {},
  getEncryptionState: jest.fn(),
  withRequestGeneration: (_header: string | null, fn: () => Promise<unknown>) => fn(),
}));

import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

import { findSessionForValidation } from '@/controllers/authSessions';
import { getEncryptionState } from '@/db/encryptionState';

import { GET } from '../[...nextauth]/route';

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockFindSession = findSessionForValidation as jest.MockedFunction<typeof findSessionForValidation>;
const mockGetEncryptionState = getEncryptionState as jest.MockedFunction<typeof getEncryptionState>;

const initialState = {
  userId: 'u1',
  generation: 0,
  sessionEpoch: 0,
  survivingSid: null,
  rotationSessionSid: null,
  activeRotationId: null,
};

beforeEach(() => {
  mockGetToken.mockReset();
  mockFindSession.mockReset();
  mockGetEncryptionState.mockResolvedValue(initialState);
  nextAuthHandler.mockClear();
});

function setToken(token: Record<string, unknown> | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetToken.mockResolvedValue(token as any);
}

/** A session request carrying the two cookie shapes NextAuth may have written. */
function sessionReq(): NextRequest {
  return new NextRequest('http://localhost/api/auth/session', {
    headers: { cookie: 'next-auth.session-token.0=aaa; next-auth.session-token.1=bbb; other=keep' },
  });
}

const call = (req: NextRequest) => GET(req, { params: Promise.resolve({ nextauth: ['session'] }) });

const cleared = (res: NextResponse) =>
  res.cookies
    .getAll()
    .filter((c) => c.value === '' && c.maxAge === 0)
    .map((c) => c.name)
    .sort();

const liveRow = (over: Partial<{ expiresAt: Date; revokedAt: Date | null }> = {}) => ({
  _id: 'sid1',
  userId: 'u1',
  provider: 'google' as const,
  client: 'web' as const,
  ip: '',
  userAgent: '',
  browser: '',
  os: '',
  deviceType: 'desktop' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: new Date(Date.now() + 1000_000),
  revokedAt: null,
  ...over,
});

describe('GET /api/auth/session', () => {
  // The endpoint that used to keep a sid-less JWT alive by re-issuing its
  // cookie. Nothing can revoke such a token, so ending it here is the only
  // exit — and it must not reach NextAuth, which would roll the cookie forward.
  it('returns the signed-out shape and clears cookies for a sid-less token', async () => {
    setToken({ sub: 'u1' });
    const res = await call(sessionReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(cleared(res)).toEqual(['next-auth.session-token.0', 'next-auth.session-token.1']);
    expect(nextAuthHandler).not.toHaveBeenCalled();
    // Never consulted: there is no sid to look up.
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('returns the signed-out shape and clears cookies for a revoked sid', async () => {
    setToken({ sub: 'u1', sid: 'sid1' });
    mockFindSession.mockResolvedValueOnce(liveRow({ revokedAt: new Date() }));
    const res = await call(sessionReq());
    expect(await res.json()).toEqual({});
    expect(cleared(res)).toEqual(['next-auth.session-token.0', 'next-auth.session-token.1']);
    expect(nextAuthHandler).not.toHaveBeenCalled();
  });

  it('clears cookies for an expired session row', async () => {
    setToken({ sub: 'u1', sid: 'sid1' });
    mockFindSession.mockResolvedValueOnce(liveRow({ expiresAt: new Date(Date.now() - 1000) }));
    const res = await call(sessionReq());
    expect(await res.json()).toEqual({});
    expect(nextAuthHandler).not.toHaveBeenCalled();
  });

  it('clears cookies for a stale epoch token before NextAuth can refresh it', async () => {
    setToken({ sub: 'u1', sid: 'sid1', sessionEpoch: 1 });
    mockGetEncryptionState.mockResolvedValueOnce({ ...initialState, sessionEpoch: 2, survivingSid: 'keep' });
    mockFindSession.mockResolvedValueOnce(liveRow());
    const res = await call(sessionReq());
    expect(await res.json()).toEqual({});
    expect(cleared(res)).toEqual(['next-auth.session-token.0', 'next-auth.session-token.1']);
    expect(nextAuthHandler).not.toHaveBeenCalled();
  });

  it('keeps the durable survivor usable through the session endpoint', async () => {
    setToken({ sub: 'u1', sid: 'sid1', sessionEpoch: 1 });
    mockGetEncryptionState.mockResolvedValueOnce({ ...initialState, sessionEpoch: 2, survivingSid: 'sid1' });
    mockFindSession.mockResolvedValueOnce(liveRow());
    await call(sessionReq());
    expect(nextAuthHandler).toHaveBeenCalled();
  });

  it('delegates to NextAuth while the row has not been lazily created yet', async () => {
    setToken({ sub: 'u1', sid: 'sid1' });
    mockFindSession.mockResolvedValueOnce(null);
    const res = await call(sessionReq());
    expect(nextAuthHandler).toHaveBeenCalled();
    expect(await res.json()).toEqual({ user: { id: 'u1' } });
  });

  it('delegates to NextAuth for a live session', async () => {
    setToken({ sub: 'u1', sid: 'sid1' });
    mockFindSession.mockResolvedValueOnce(liveRow());
    await call(sessionReq());
    expect(nextAuthHandler).toHaveBeenCalled();
  });

  it('delegates to NextAuth when there is no token at all', async () => {
    setToken(null);
    await call(sessionReq());
    expect(nextAuthHandler).toHaveBeenCalled();
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('leaves non-session routes alone', async () => {
    setToken({ sub: 'u1' });
    const req = new NextRequest('http://localhost/api/auth/csrf');
    await GET(req, { params: Promise.resolve({ nextauth: ['csrf'] }) });
    expect(nextAuthHandler).toHaveBeenCalled();
  });
});
