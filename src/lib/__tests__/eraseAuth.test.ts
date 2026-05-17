jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/config/auth', () => ({ authOptions: {} }));
jest.mock('@/utils/mongoose', () => ({ getMongoClientFromMongoose: jest.fn().mockResolvedValue({ kind: 'mock-client' }) }));
jest.mock('@vercel/functions', () => ({ attachDatabasePool: jest.fn() }));

import jwt from 'jsonwebtoken';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { attachDatabasePool } from '@vercel/functions';

import {
  issueEraseToken,
  withEraseAuth,
  ERASE_ALL_SCOPE,
  ERASE_ENCRYPTION_SCOPE,
} from '@/lib/eraseAuth';

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockAttachDatabasePool = attachDatabasePool as jest.MockedFunction<typeof attachDatabasePool>;

const TEST_SECRET = 'test-secret-please-ignore-do-not-use-in-prod';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = TEST_SECRET;
});

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockAttachDatabasePool.mockClear();
});

function buildReq(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/erase', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function setSession(userId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetServerSession.mockResolvedValue(userId ? ({ user: { id: userId } } as any) : null);
}

async function readJson(res: NextResponse) {
  return res.json();
}

describe('issueEraseToken', () => {
  it('signs a JWT that round-trips with NEXTAUTH_SECRET and contains userId and scope', () => {
    const token = issueEraseToken('user-1', ERASE_ALL_SCOPE);
    const decoded = jwt.verify(token, TEST_SECRET) as { userId: string; scope: string };
    expect(decoded.userId).toBe('user-1');
    expect(decoded.scope).toBe(ERASE_ALL_SCOPE);
  });

  it('uses a 15m expiration (exp - iat === 900s)', () => {
    const token = issueEraseToken('user-1', ERASE_ENCRYPTION_SCOPE);
    const decoded = jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });
});

describe('withEraseAuth', () => {
  const handler = jest.fn(async (req: NextRequest, userId: string) => {
    void req;
    void userId;
    return NextResponse.json({ ok: true }, { status: 200 });
  });

  beforeEach(() => {
    handler.mockClear();
  });

  it('returns 401 when there is no session', async () => {
    setSession(null);
    const guarded = withEraseAuth(ERASE_ALL_SCOPE, handler);
    const res = await guarded(buildReq(`Bearer ${issueEraseToken('user-1', ERASE_ALL_SCOPE)}`));
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is missing', async () => {
    setSession('user-1');
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq());
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Missing erase token' });
  });

  it('returns 401 when authorization header is not Bearer', async () => {
    setSession('user-1');
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq('Basic abc'));
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Missing erase token' });
  });

  it('returns 401 when token has bad signature', async () => {
    setSession('user-1');
    const bad = jwt.sign({ userId: 'user-1', scope: ERASE_ALL_SCOPE }, 'wrong-secret', { expiresIn: '15m' });
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq(`Bearer ${bad}`));
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Invalid or expired erase token' });
  });

  it('returns 401 when token is expired', async () => {
    setSession('user-1');
    const expired = jwt.sign({ userId: 'user-1', scope: ERASE_ALL_SCOPE }, TEST_SECRET, { expiresIn: '-1s' });
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq(`Bearer ${expired}`));
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: 'Invalid or expired erase token' });
  });

  it('returns 403 when token scope does not match expectedScope', async () => {
    setSession('user-1');
    const token = issueEraseToken('user-1', ERASE_ENCRYPTION_SCOPE);
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq(`Bearer ${token}`));
    expect(res.status).toBe(403);
    expect(await readJson(res)).toEqual({ error: 'Invalid token scope' });
  });

  it('returns 403 when expectedScope is an array and scope is not included', async () => {
    setSession('user-1');
    const token = issueEraseToken('user-1', 'unknown-scope');
    const res = await withEraseAuth([ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE], handler)(
      buildReq(`Bearer ${token}`),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when token userId does not match session userId', async () => {
    setSession('user-1');
    const token = issueEraseToken('user-2', ERASE_ALL_SCOPE);
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq(`Bearer ${token}`));
    expect(res.status).toBe(403);
    expect(await readJson(res)).toEqual({ error: 'Token user mismatch' });
  });

  it('calls handler with userId and attaches db pool on success', async () => {
    setSession('user-1');
    const token = issueEraseToken('user-1', ERASE_ALL_SCOPE);
    const res = await withEraseAuth(ERASE_ALL_SCOPE, handler)(buildReq(`Bearer ${token}`));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBe('user-1');
    expect(mockAttachDatabasePool).toHaveBeenCalledWith({ kind: 'mock-client' });
  });

  it('accepts an array of expected scopes when scope matches', async () => {
    setSession('user-1');
    const token = issueEraseToken('user-1', ERASE_ENCRYPTION_SCOPE);
    const res = await withEraseAuth([ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE], handler)(
      buildReq(`Bearer ${token}`),
    );
    expect(res.status).toBe(200);
  });
});
