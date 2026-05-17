jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/config/auth', () => ({ authOptions: {} }));
jest.mock('@/utils/mongoose', () => ({ getMongoClientFromMongoose: jest.fn().mockResolvedValue({ kind: 'mock-client' }) }));
jest.mock('@vercel/functions', () => ({ attachDatabasePool: jest.fn() }));

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { attachDatabasePool } from '@vercel/functions';

import { RouteAuthError, assertOwner, withSession, type AuthedContext } from '@/lib/routeAuth';

type Handler = (req: NextRequest, ctx: AuthedContext) => Promise<NextResponse>;

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockAttachDatabasePool = attachDatabasePool as jest.MockedFunction<typeof attachDatabasePool>;

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockAttachDatabasePool.mockClear();
});

function setSession(userId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetServerSession.mockResolvedValue(userId ? ({ user: { id: userId } } as any) : null);
}

function buildReq(): NextRequest {
  return new NextRequest('http://localhost/x');
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
  it('returns 401 JSON when no session', async () => {
    setSession(null);
    const handler = jest.fn();
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('awaits nextCtx.params and passes them to the handler', async () => {
    setSession('u1');
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({ id: 'abc' }) });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toEqual({ userId: 'u1', params: { id: 'abc' } });
  });

  it('passes empty params object when nextCtx is undefined', async () => {
    setSession('u1');
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withSession(handler)(buildReq(), undefined as any);
    expect(handler.mock.calls[0][1]).toEqual({ userId: 'u1', params: {} });
  });

  it('returns handler response on success', async () => {
    setSession('u1');
    const handler = jest.fn(async () => NextResponse.json({ ok: true }, { status: 201 }));
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('catches RouteAuthError and returns JSON with its status/body', async () => {
    setSession('u1');
    const handler = jest.fn(async () => {
      throw new RouteAuthError(403, 'Forbidden');
    });
    const res = await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('rethrows non-RouteAuthError errors', async () => {
    setSession('u1');
    const handler = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(withSession(handler)(buildReq(), { params: Promise.resolve({}) })).rejects.toThrow('boom');
  });

  it('attaches mongo client to the database pool before invoking handler', async () => {
    setSession('u1');
    const handler = jest.fn<ReturnType<Handler>, Parameters<Handler>>(async () => NextResponse.json({ ok: true }));
    await withSession(handler)(buildReq(), { params: Promise.resolve({}) });
    expect(mockAttachDatabasePool).toHaveBeenCalledWith({ kind: 'mock-client' });
  });
});
