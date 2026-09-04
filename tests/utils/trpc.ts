import type { APIRequestContext, APIResponse, Response } from '@playwright/test';

// Helpers for driving tRPC procedures over HTTP from Playwright, using the
// single (non-batched) RPC format: queries are GET (input in the `?input=` query
// param), mutations are POST with the input as the JSON body, and the payload is
// wrapped in `{ result: { data } }`.

const BASE = '/api/trpc';

const TRANSIENT_GET_ERROR = /(?:ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up)/i;

/**
 * Playwright's API client can try to reuse a socket just as the Node server
 * closes an idle keep-alive connection. Queries are safe to repeat, so absorb
 * that transport-only race here instead of turning a successful UI action
 * into a test failure. Mutations intentionally do not use this helper.
 */
async function getWithRetry(request: APIRequestContext, url: string): Promise<APIResponse> {
  const delays = [100, 250];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request.get(url);
    } catch (error) {
      if (attempt >= delays.length || !TRANSIENT_GET_ERROR.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/** Calls a query procedure (GET). Returns the raw APIResponse so callers can
 *  assert on status (e.g. 401) before unwrapping. Pass `input` for procedures
 *  that require one (e.g. the tier `list` procedures). */
export function trpcQuery(request: APIRequestContext, path: string, input?: unknown) {
  const url =
    input === undefined ? `${BASE}/${path}` : `${BASE}/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  return getWithRetry(request, url);
}

/** Calls a mutation procedure (POST). Pass `input` as the body, or omit it.
 *  A no-input mutation still needs a valid JSON body (`{}`) — an empty body makes
 *  the tRPC fetch adapter fail to parse the input. */
export function trpcMutate(request: APIRequestContext, path: string, input?: unknown) {
  return request.post(`${BASE}/${path}`, { data: input === undefined ? {} : input });
}

/** Unwraps `{ result: { data } }` from a successful single (non-batched) tRPC response. */
export async function trpcData<T>(response: { json(): Promise<unknown> }): Promise<T> {
  const body = (await response.json()) as { result?: { data?: T } };
  return body.result!.data as T;
}

/** Unwraps data from a BATCHED tRPC response (httpBatchLink wraps results in an
 *  array). Use for responses captured via `page.waitForResponse` — i.e. real UI
 *  traffic, which always goes through the batch link. */
export async function trpcBatchData<T>(response: { json(): Promise<unknown> }): Promise<T> {
  const body = (await response.json()) as Array<{ result?: { data?: T } }>;
  return body[0].result!.data as T;
}

type TrpcResponseLike = {
  ok: () => boolean;
  status: () => number;
  raw: APIResponse;
  // The unwrapped tRPC `result.data` (or undefined on error). `any` so existing
  // REST-style call sites (`(await res.json()).find(...)`) keep working.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>;
};

function wrap(res: APIResponse): TrpcResponseLike {
  return {
    ok: () => res.ok(),
    status: () => res.status(),
    raw: res,
    json: async () => {
      const body = (await res.json()) as { result?: { data?: unknown } };
      return body?.result?.data;
    },
  };
}

/**
 * REST-shim for a tRPC query: returns a response-like object whose `.json()`
 * yields the unwrapped data array/object, so call sites that did
 * `(await page.request.get('/api/notes')).json()` keep working verbatim.
 */
export async function trpcGet(
  request: APIRequestContext,
  path: string,
  input: unknown = {},
): Promise<TrpcResponseLike> {
  return wrap(await trpcQuery(request, path, input));
}

/** REST-shim for a tRPC mutation; `.json()` yields the unwrapped data (undefined on error). */
export async function trpcPost(request: APIRequestContext, path: string, input?: unknown): Promise<TrpcResponseLike> {
  return wrap(await trpcMutate(request, path, input));
}

/**
 * Predicate for `page.waitForResponse` / request listeners: matches a tRPC
 * mutation (POST) whose URL targets the given procedure prefix. Pass a tier
 * prefix like `'notes.'` to match any of that tier's mutations (create, update,
 * setColor, …) — the migration equivalent of the old `'/api/notes/' && PATCH`.
 */
export const trpcMutationOf =
  (procPrefix: string) =>
  (r: Response): boolean =>
    r.url().includes(`${BASE}/${procPrefix}`) && r.request().method() === 'POST';

/** Like `trpcMutationOf` but for query (GET) procedures — e.g. infinite-scroll
 *  page fetches that used to watch `'/api/secrets' && GET`. */
export const trpcQueryOf =
  (procPrefix: string) =>
  (r: Response): boolean =>
    r.url().includes(`${BASE}/${procPrefix}`) && r.request().method() === 'GET';
