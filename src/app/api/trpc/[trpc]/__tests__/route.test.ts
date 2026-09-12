import { z } from 'zod';

const mockAuthenticateRequest = jest.fn();

jest.mock('@/lib/routeAuth', () => {
  const actual = jest.requireActual('@/lib/routeAuth');
  return { ...actual, authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args) };
});

jest.mock('@/server/context', () => ({
  createContext: ({ req }: { req: Request }) => ({ req }),
}));

jest.mock('@/server/routers/_app', () => {
  const { protectedProcedure, publicProcedure, router } = jest.requireActual('@/server/trpc');
  const { VaultConflictError } = jest.requireActual('@/db/encryptionState');
  return {
    appRouter: router({
      health: publicProcedure.query(() => ({ ok: true })),
      rotation: router({
        echo: publicProcedure
          .input(z.object({ value: z.string() }))
          .mutation(({ input }: { input: { value: string } }) => input),
        conflict: protectedProcedure.mutation(() => {
          throw new VaultConflictError('GENERATION_MISMATCH');
        }),
      }),
    }),
  };
});

import { RouteAuthError } from '@/lib/routeAuth';

import { POST } from '../route';

function jsonRequest(path: string, payload: unknown): Request {
  return new Request(`http://localhost/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function streamedRequest(path: string, chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request(`http://localhost/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    // Node's fetch implementation requires this for a streaming request body.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('tRPC transport generation fencing', () => {
  beforeEach(() => {
    mockAuthenticateRequest.mockReset();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1', sid: 'sid-1' });
  });

  it('maps a VaultConflictError returned inside next() to HTTP 409', async () => {
    const response = await POST(jsonRequest('rotation.conflict', { json: null }));
    const body = await responseJson(response);

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({
      error: {
        data: { code: 'CONFLICT', httpStatus: 409 },
        message: 'GENERATION_MISMATCH',
      },
    });
  });

  it('keeps an authentication failure as HTTP 401 instead of a fencing conflict', async () => {
    mockAuthenticateRequest.mockRejectedValueOnce(new RouteAuthError(401, 'Unauthorized'));

    const response = await POST(jsonRequest('rotation.conflict', { json: null }));
    const body = await responseJson(response);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({ error: { data: { code: 'UNAUTHORIZED', httpStatus: 401 } } });
  });

  it('rejects a decoded rotation batch before authentication and marks the error no-store', async () => {
    const response = await POST(jsonRequest('rotation.conflict%2Crotation.conflict?batch=1', { json: null }));
    const body = await responseJson(response);

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toEqual({ error: 'Rotation procedures must be sent individually' });
    expect(mockAuthenticateRequest).not.toHaveBeenCalled();
  });

  it('reads chunked rotation bodies incrementally and forwards a bounded body to tRPC', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ value: 'forwarded' }));
    const response = await POST(streamedRequest('rotation.echo', [body.subarray(0, 4), body.subarray(4)]));
    const result = await responseJson(response);

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ result: { data: { value: 'forwarded' } } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects an oversized chunked body without relying on Content-Length', async () => {
    const response = await POST(
      streamedRequest('rotation.echo', [new Uint8Array(2_000_000), new Uint8Array(1_000_001)]),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await responseJson(response)).toEqual({ error: 'Rotation request too large' });
  });
});
