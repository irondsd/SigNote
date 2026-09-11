/**
 * The rotation-only transport.
 *
 * Three things make it separate from every other tRPC client in the app:
 *
 * 1. **It does not batch.** `httpBatchLink` merges whatever is in flight into
 *    one request, and two parallel 750,000-character payloads merge into a
 *    request no deployment will accept. The server rejects a batched rotation
 *    path outright (`api/trpc/[trpc]/route.ts`), so batching here would not
 *    even fail usefully.
 *
 * 2. **It counts bytes, in both directions.** Server limits are authoritative,
 *    but a 413 that arrives after uploading three megabytes is a wasted round
 *    trip, and a retry of the identical payload is a loop. The budget is
 *    enforced before the request leaves and again on the way back, so a page
 *    that grew past the response budget surfaces as a limit rather than as a
 *    truncated inventory.
 *
 * 3. **It never triggers the global sign-out.** `unauthorizedLink` toasts,
 *    broadcasts a logout to every tab and navigates away. In the middle of a
 *    rotation that would discard in-memory keys with no chance to stop the
 *    worker cleanly. A genuine 401 still has to stop everything — it just has
 *    to be the rotation's own code that does it, keeping the durable operation
 *    identity so the user can re-authenticate and resume the same operation.
 *    Other clients may still start a global sign-out on a real revocation;
 *    resume survives that because the operation lives in the database.
 */

import { createTRPCClient, httpLink, type TRPCClientErrorLike } from '@trpc/client';

import type { AppRouter } from '@/server/routers/_app';
import { getSessionClientHeaders } from '@/lib/sessionClient';

/**
 * Mirrors `ROTATION_LIMITS` in `src/server/rotation/contracts.ts`. The server's
 * numbers win — `status` and `begin` both return them — but a client needs a
 * budget before it has spoken to the server at all.
 */
export const ROTATION_TRANSPORT_BUDGET = {
  maxRequestBytes: 3_000_000,
  maxResponseBytes: 3_000_000,
};

export type RotationTransportCode =
  /** The session is gone. Stop every transfer, drop in-memory keys, re-auth. */
  | 'UNAUTHORIZED'
  /** Another account's operation, or one that does not exist. Not disclosed apart. */
  | 'NOT_FOUND'
  /** Fence, generation, ownership or state conflict. Needs an explicit decision. */
  | 'CONFLICT'
  /** Storage refused, or a prerequisite is not met. */
  | 'PRECONDITION_FAILED'
  /** Over a byte budget. Repeating the identical payload cannot succeed. */
  | 'PAYLOAD_TOO_LARGE'
  /** Malformed input. A bug, not a transient fault. */
  | 'BAD_REQUEST'
  /** Network or server fault. Safe to retry with backoff. */
  | 'TRANSIENT';

export class RotationTransportError extends Error {
  constructor(
    readonly code: RotationTransportCode,
    /** The server's own `RotationError` code when it sent one, for the UI. */
    readonly reason: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(reason ? `${code}: ${reason}` : code, options);
    this.name = 'RotationTransportError';
  }

  /**
   * Only network and server faults are repeated automatically. Authorization,
   * generation, integrity and ownership failures all need an explicit action —
   * retrying them silently is how a wizard ends up hammering a fence it will
   * never pass.
   */
  get retryable(): boolean {
    return this.code === 'TRANSIENT';
  }
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

function requestBytes(input: RequestInfo | URL, init?: RequestInit): number {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body;
  return byteLength(url) + (typeof body === 'string' ? byteLength(body) : 0);
}

/**
 * The transport's `fetch`. Enforces both budgets and forbids a cached answer:
 * a stale rotation response could describe staging that no longer exists.
 *
 * `cache: 'no-store'` alone does not override an already-installed service
 * worker, which is why `src/sw.ts` claims these paths as NetworkOnly as well.
 */
function budgetedFetch(budget = ROTATION_TRANSPORT_BUDGET) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (requestBytes(input, init) > budget.maxRequestBytes) {
      throw new RotationTransportError('PAYLOAD_TOO_LARGE', 'REQUEST_BUDGET');
    }
    const response = await fetch(input, { ...init, cache: 'no-store', credentials: 'same-origin' });
    // Infrastructure errors need not use the tRPC JSON envelope. In particular,
    // retrying an HTML/plain-text 413 can never make the request fit.
    if (response.status === 413 || response.status === 401) {
      await response.body?.cancel();
      throw new RotationTransportError(response.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNAUTHORIZED');
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > budget.maxResponseBytes) {
      throw new RotationTransportError('PAYLOAD_TOO_LARGE', 'RESPONSE_BUDGET');
    }
    // The body was consumed to measure it, so hand the adapter an equivalent
    // response rather than a stream it can no longer read.
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function createRotationClient(budget = ROTATION_TRANSPORT_BUDGET) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: '/api/trpc',
        // Deliberately no generation header: rotation procedures carry their
        // source generation in the worker token, and the account is mid-flight
        // between two generations for the whole operation.
        headers: getSessionClientHeaders,
        fetch: budgetedFetch(budget) as typeof fetch,
      }),
    ],
  });
}

export const rotationClient = createRotationClient();

type WireError = TRPCClientErrorLike<AppRouter> & { cause?: unknown };

const CODE_MAP: Record<string, RotationTransportCode> = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  BAD_REQUEST: 'BAD_REQUEST',
  PARSE_ERROR: 'BAD_REQUEST',
};

/**
 * Normalise anything thrown by the transport into one decision.
 *
 * `FORBIDDEN` collapses into `NOT_FOUND` on purpose: a request for another
 * account's operation must not be distinguishable from a request for one that
 * does not exist.
 */
export function asRotationError(error: unknown): RotationTransportError {
  if (error instanceof RotationTransportError) return error;

  const wire = error as WireError | undefined;
  // A budget refusal is thrown from inside the transport's own `fetch`, so tRPC
  // wraps it before the caller ever sees it. Unwrap rather than reclassifying a
  // deliberate local limit as a transient network fault.
  if (wire?.cause instanceof RotationTransportError) return wire.cause;
  const httpStatus = (wire?.data as { httpStatus?: number } | undefined)?.httpStatus;
  const code = wire?.data?.code;

  if (code && CODE_MAP[code]) {
    return new RotationTransportError(CODE_MAP[code], wire?.message ?? null, { cause: error });
  }
  if (code === 'INTERNAL_SERVER_ERROR' || (typeof httpStatus === 'number' && httpStatus >= 500)) {
    return new RotationTransportError('TRANSIENT', wire?.message ?? null, { cause: error });
  }
  // A fetch that never produced a response: offline, DNS, aborted connection.
  return new RotationTransportError('TRANSIENT', null, { cause: error });
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: RotationTransportError) => void;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bounded exponential backoff for transient faults only.
 *
 * The caller must pass an operation that is safe to repeat — every rotation
 * mutation is, because each one binds an idempotency key to its exact payload
 * digest and a committed retry returns the original receipt.
 */
export async function withRotationRetry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 4, baseDelayMs = 500, maxDelayMs = 8_000, signal, onRetry, sleep = defaultSleep } = options;
  let lastError: RotationTransportError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      const normalised = asRotationError(error);
      if (!normalised.retryable || attempt === attempts) throw normalised;
      lastError = normalised;
      onRetry?.(attempt, normalised);
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  /* istanbul ignore next — the loop either returns or throws. */
  throw lastError ?? new RotationTransportError('TRANSIENT');
}
