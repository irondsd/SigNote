jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: (cb: () => unknown) => cb() };
});
jest.mock('@/config/auth', () => ({ authOptions: {} }));
jest.mock('@/utils/mongoose', () => ({
  getMongoClientFromMongoose: jest.fn().mockResolvedValue({ kind: 'mock-client' }),
}));
jest.mock('@vercel/functions', () => ({ attachDatabasePool: jest.fn() }));
jest.mock('@/controllers/authSessions', () => ({
  TOUCH_THROTTLE_MS: 5 * 60 * 1000,
  findSessionForValidation: jest.fn(),
  touchSession: jest.fn(),
  upsertSessionIfMissing: jest.fn(),
}));

import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { attachDatabasePool } from '@vercel/functions';

import { findSessionForValidation, touchSession, upsertSessionIfMissing } from '@/controllers/authSessions';
import { RouteAuthError, assertOwner, withSession, type AuthedContext } from '@/lib/routeAuth';

type Handler = (req: NextRequest, ctx: AuthedContext) => Promise<NextResponse>;

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockAttachDatabasePool = attachDatabasePool as jest.MockedFunction<typeof attachDatabasePool>;
const mockFindSession = findSessionForValidation as jest.MockedFunction<typeof findSessionForValidation>;
const mockTouchSession = touchSession as jest.MockedFunction<typeof touchSession>;
const mockUpsertSession = upsertSessionIfMissing as jest.MockedFunction<typeof upsertSessionIfMissing>;

beforeEach(() => {
  mockGetToken.mockReset();
  mockAttachDatabasePool.mockClear();
  mockFindSession.mockReset();
  mockTouchSession.mockClear();
  mockUpsertSession.mockClear();
});

function setToken(token: Record<string, unknown> | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetToken.mockResolvedValue(token as any);
}

function buildReq(): NextRequest {
  return new NextRequest('http://localhost/x', {
    headers: { 'user-agent': 'TestUA', 'x-forwarded-for': '9.9.9.9' },
  });
}

describe('RouteAuthError', () => {
  it('exposes status and body { error: message }', () => {
    const err = new RouteAuthError(403, 'Forbidden');
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ error: 'Forbidden' });
    expect(err.message).toBe('Forbidden');
  });

  it('is an instance of Error', () => {
    expect(new RouteAuthError(404, 'Not found')).toBeInstanceOf(Error);
  });
});

describe('assertOwner', () => {
  it('returns the resource when userId matches', () => {
    const resource = { userId: 'u1', value: 42 };
    expect(assertOwner(resource, 'u1')).toBe(resource);
  });

  it('throws RouteAuthError 404 when resource is null', () => {
    try {
      assertOwner(null, 'u1');
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RouteAuthError);
      expect((e as RouteAuthError).status).toBe(404);
    }
  });

  it('throws RouteAuthError 404 when resource is undefined', () => {
    expect(() => assertOwner(undefined, 'u1')).toThrow(RouteAuthError);
  });

  it('throws RouteAuthError 403 when userId does not match caller', () => {
    try {
      assertOwner({ userId: 'u2' }, 'u1');
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RouteAuthError);
      expect((e as RouteAuthError).status).toBe(403);
    }
  });
});

describe('withSession', () => {
  it('returns 401 JSON when no token', async () => {
    setToken(null);
    const handler = jest.fn();
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 401 JSON when token has no sub', async () => {
    setToken({ sid: 'abc' });
    const handler = jest.fn();
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it('passes legacy JWTs (no sid) straight through to handler', async () => {
    setToken({ sub: 'u1' });
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({ id: 'abc' }) });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toEqual({ userId: 'u1', sid: null, params: { id: 'abc' } });
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('returns 401 when session row is revoked', async () => {
    setToken({ sub: 'u1', sid: 'sid1', provider: 'google' });
    mockFindSession.mockResolvedValueOnce({
      _id: 'sid1' as never,
      userId: 'u1',
      provider: 'google',
      ip: '',
      userAgent: '',
      browser: '',
      os: '',
      deviceType: 'desktop',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    const handler = jest.fn();
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Session revoked' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 401 when session row has expired', async () => {
    setToken({ sub: 'u1', sid: 'sid1', provider: 'google' });
    mockFindSession.mockResolvedValueOnce({
      _id: 'sid1' as never,
      userId: 'u1',
      provider: 'google',
      ip: '',
      userAgent: '',
      browser: '',
      os: '',
      deviceType: 'desktop',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    });
    const handler = jest.fn();
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it('lazy-upserts a missing session row on first authed request', async () => {
    setToken({ sub: 'u1', sid: 'sid1', provider: 'google' });
    mockFindSession.mockResolvedValueOnce(null);
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(mockUpsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sid: 'sid1',
        userId: 'u1',
        provider: 'google',
        ip: '9.9.9.9',
        userAgent: 'TestUA',
      }),
    );
    expect(handler.mock.calls[0][1]).toEqual({ userId: 'u1', sid: 'sid1', params: {} });
  });

  it('does not touch a fresh session row', async () => {
    setToken({ sub: 'u1', sid: 'sid1', provider: 'google' });
    mockFindSession.mockResolvedValueOnce({
      _id: 'sid1' as never,
      userId: 'u1',
      provider: 'google',
      ip: '',
      userAgent: '',
      browser: '',
      os: '',
      deviceType: 'desktop',
      createdAt: new Date(),
      updatedAt: new Date(), // fresh
      expiresAt: new Date(Date.now() + 1000_000),
      revokedAt: null,
    });
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  it('touches a stale session row (fire-and-forget)', async () => {
    setToken({ sub: 'u1', sid: 'sid1', provider: 'google' });
    mockFindSession.mockResolvedValueOnce({
      _id: 'sid1' as never,
      userId: 'u1',
      provider: 'google',
      ip: '',
      userAgent: '',
      browser: '',
      os: '',
      deviceType: 'desktop',
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago, > 5 min throttle
      expiresAt: new Date(Date.now() + 1000_000),
      revokedAt: null,
    });
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(mockTouchSession).toHaveBeenCalledWith('sid1', '9.9.9.9', 'TestUA');
  });

  it('passes empty params object when nextCtx is undefined', async () => {
    setToken({ sub: 'u1' });
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withSession(handler)(buildReq(), undefined as any);
    expect(handler.mock.calls[0][1]).toEqual({ userId: 'u1', sid: null, params: {} });
  });

  it('returns handler response on success', async () => {
    setToken({ sub: 'u1' });
    const handler = jest.fn(async () => NextResponse.json({ ok: true }, { status: 201 }));
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('catches RouteAuthError and returns JSON with its status/body', async () => {
    setToken({ sub: 'u1' });
    const handler = jest.fn(async () => {
      throw new RouteAuthError(403, 'Forbidden');
    });
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('rethrows non-RouteAuthError errors', async () => {
    setToken({ sub: 'u1' });
    const handler = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(withSession(handler)(buildReq(), { params: Promise.resolve({}) })).rejects.toThrow('boom');
  });

  it('attaches mongo client to the database pool before invoking handler', async () => {
    setToken({ sub: 'u1' });
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(mockAttachDatabasePool).toHaveBeenCalledWith({ kind: 'mock-client' });
  });
});
