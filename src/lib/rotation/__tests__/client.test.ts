/**
 * The Node environment, not jsdom: this exercises a real `fetch`/`Response`
 * round trip through the tRPC adapter, and jsdom supplies neither those nor
 * `TextEncoder`, which is what the byte budget is measured with.
 */

import {
  RotationTransportError,
  asRotationError,
  createRotationClient,
  withRotationRetry,
} from '@/lib/rotation/client';

type FetchCall = { url: string; init: RequestInit | undefined };

function installFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ result: { data } }), { status, headers: { 'content-type': 'application/json' } });

const errorResponse = (code: string, httpStatus: number, message = code) =>
  new Response(JSON.stringify({ error: { message, code: -32600, data: { code, httpStatus } } }), {
    status: httpStatus,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  // @ts-expect-error restored per test by installFetch
  delete globalThis.fetch;
});

describe('transport shape', () => {
  it('sends each procedure on its own request, never batched', async () => {
    const calls = installFetch(() => jsonResponse({ generation: 0, operation: null }));
    const client = createRotationClient();

    await Promise.all([client.rotation.status.query(), client.rotation.status.query()]);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).not.toContain('batch=1');
      expect(call.url).not.toContain(',');
    }
  });

  it('refuses a cached answer', async () => {
    const calls = installFetch(() => jsonResponse({ generation: 0, operation: null }));

    await createRotationClient().rotation.status.query();

    expect(calls[0].init?.cache).toBe('no-store');
  });
});

describe('byte budgets', () => {
  it('refuses an oversized request before it leaves the browser', async () => {
    const calls = installFetch(() => jsonResponse({ ok: true }));
    const client = createRotationClient({ maxRequestBytes: 2_000, maxResponseBytes: 3_000_000 });

    const error = await client.rotation.stage
      .mutate({
        operationId: '00000000-0000-7000-8000-000000000000',
        generation: 0,
        workerFence: 1,
        item: { kind: 'secret', resourceId: 'a'.repeat(120) },
        replacement: { alg: 'A256GCM', iv: 'x'.repeat(16), ciphertext: 'y'.repeat(4_000) },
        stageKey: 'key-1',
      })
      .catch(asRotationError);

    expect(error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', reason: 'REQUEST_BUDGET' });
    expect(calls).toHaveLength(0);
  });

  it('refuses an oversized response rather than returning a partial one', async () => {
    installFetch(() => jsonResponse({ items: 'z'.repeat(5_000) }));
    const client = createRotationClient({ maxRequestBytes: 3_000_000, maxResponseBytes: 2_000 });

    const error = await client.rotation.status.query().catch(asRotationError);

    expect(error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', reason: 'RESPONSE_BUDGET' });
  });

  it('passes a response that fits', async () => {
    installFetch(() => jsonResponse({ generation: 3, operation: null }));

    await expect(createRotationClient().rotation.status.query()).resolves.toEqual({
      generation: 3,
      operation: null,
    });
  });
});

describe('error classification', () => {
  it('keeps a real 401 as its own stop signal', async () => {
    installFetch(() => errorResponse('UNAUTHORIZED', 401));

    const error = await createRotationClient()
      .rotation.status.query()
      .then(() => null)
      .catch((err: unknown) => asRotationError(err));

    expect(error?.code).toBe('UNAUTHORIZED');
    expect(error?.retryable).toBe(false);
  });

  it('does not distinguish a foreign operation from a missing one', () => {
    expect(asRotationError({ data: { code: 'FORBIDDEN', httpStatus: 403 } }).code).toBe('NOT_FOUND');
    expect(asRotationError({ data: { code: 'NOT_FOUND', httpStatus: 404 } }).code).toBe('NOT_FOUND');
  });

  it('treats a fence conflict as needing an explicit decision', () => {
    const error = asRotationError({ data: { code: 'CONFLICT', httpStatus: 409 }, message: 'CONFLICT' });
    expect(error.code).toBe('CONFLICT');
    expect(error.retryable).toBe(false);
  });

  it('carries the server reason through for the wizard to show', () => {
    const error = asRotationError({
      data: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
      message: 'SESSION_PREREQUISITE',
    });
    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', reason: 'SESSION_PREREQUISITE' });
  });

  it('treats a server fault and a dead network as transient', () => {
    expect(asRotationError({ data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } }).retryable).toBe(true);
    expect(asRotationError(new TypeError('Failed to fetch')).retryable).toBe(true);
  });

  it('never re-wraps its own error', () => {
    const original = new RotationTransportError('CONFLICT', 'EXPIRED');
    expect(asRotationError(original)).toBe(original);
  });
});

describe('retry policy', () => {
  const noSleep = async () => undefined;

  it('repeats a transient fault with growing delays', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withRotationRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new RotationTransportError('TRANSIENT');
        return 'done';
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('never repeats an over-budget payload', async () => {
    let attempts = 0;
    await expect(
      withRotationRetry(
        async () => {
          attempts++;
          throw new RotationTransportError('PAYLOAD_TOO_LARGE', 'REQUEST_BUDGET');
        },
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });

    expect(attempts).toBe(1);
  });

  it('never repeats an authorization or fence failure', async () => {
    for (const code of ['UNAUTHORIZED', 'CONFLICT', 'NOT_FOUND', 'PRECONDITION_FAILED'] as const) {
      let attempts = 0;
      await expect(
        withRotationRetry(
          async () => {
            attempts++;
            throw new RotationTransportError(code);
          },
          { sleep: noSleep },
        ),
      ).rejects.toMatchObject({ code });
      expect(attempts).toBe(1);
    }
  });

  it('gives up after the bounded number of attempts', async () => {
    let attempts = 0;
    await expect(
      withRotationRetry(
        async () => {
          attempts++;
          throw new TypeError('Failed to fetch');
        },
        { attempts: 3, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'TRANSIENT' });

    expect(attempts).toBe(3);
  });

  it('stops immediately when the operation is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(withRotationRetry(async () => 'never', { signal: controller.signal })).rejects.toThrow();
  });
});
