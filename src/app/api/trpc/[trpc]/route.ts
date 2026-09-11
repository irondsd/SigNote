import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { NextResponse } from 'next/server';

import { createContext } from '@/server/context';
import { appRouter } from '@/server/routers/_app';

export const runtime = 'nodejs';

const ROTATION_BODY_LIMIT = 3_000_000;

const noStore = { 'Cache-Control': 'private, no-store' };

function decodedPathname(req: Request): string {
  const pathname = new URL(req.url).pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    // Let tRPC return its normal malformed-path response. Detection still
    // errs toward the ordinary handler when the path cannot be decoded.
    return pathname;
  }
}

const isRotationPath = (req: Request): boolean => {
  const pathname = decodedPathname(req);
  return (
    pathname
      .split('/')
      .pop()
      ?.split(',')
      .some((part) => part.startsWith('rotation.')) ?? false
  );
};

type BodyReadResult = { body: Uint8Array; tooLarge: false } | { body: null; tooLarge: true };

/** Read at most limit + 1 bytes so chunked requests cannot force an unbounded
 * clone/arrayBuffer allocation before the size check. */
async function readBoundedBody(req: Request, limit: number): Promise<BodyReadResult> {
  if (!req.body) return { body: new Uint8Array(), tooLarge: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { body: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, tooLarge: false };
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}

const handler = async (req: Request) => {
  const rotationPath = isRotationPath(req);
  let forwardedReq = req;
  if (rotationPath) {
    const url = new URL(req.url);
    const pathname = decodedPathname(req);
    if (url.searchParams.get('batch') === '1' || pathname.includes(',')) {
      return errorResponse('Rotation procedures must be sent individually', 400);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const result = await readBoundedBody(req, ROTATION_BODY_LIMIT);
      if (result.tooLarge) return errorResponse('Rotation request too large', 413);
      // Reading the original stream consumes it. Recreate the request so the
      // tRPC adapter receives the exact bounded bytes we just inspected.
      forwardedReq = new Request(req, { body: result.body.buffer as ArrayBuffer });
    }
  }

  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: forwardedReq,
    router: appRouter,
    createContext: () => createContext({ req: forwardedReq }),
  });
  response.headers.set('Cache-Control', noStore['Cache-Control']);
  return response;
};

export { handler as GET, handler as POST };
