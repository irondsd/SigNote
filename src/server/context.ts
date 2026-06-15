import { NextRequest } from 'next/server';

/**
 * Per-request tRPC context. We intentionally do NOT authenticate here — the
 * fetch adapter calls this for every request, including ones that may be
 * public. `protectedProcedure` runs `authenticateRequest` lazily via middleware
 * so unauthenticated procedures don't pay for (or fail) session validation.
 */
export async function createContext({ req }: { req: Request }) {
  // getToken needs a NextRequest to read the auth cookie. Build one from the URL
  // and headers only — NOT `new NextRequest(req)`, which hits a broken undici
  // clone path ("Cannot read private member #state"), and NOT forwarding the
  // body, which tRPC still needs to read downstream. Cookies are parsed from the
  // `cookie` header; getClientIp only reads headers.
  const nextReq = new NextRequest(req.url, { headers: req.headers });
  return { req: nextReq };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
