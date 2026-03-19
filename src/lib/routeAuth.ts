import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { type Address } from 'viem';

import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export class RouteAuthError extends Error {
  readonly status: 401 | 403 | 404;
  readonly body: Record<string, string>;

  constructor(status: 401 | 403 | 404, message: string) {
    super(message);
    this.status = status;
    this.body = { error: message };
  }
}

export interface AuthedContext {
  address: Address;
  params: Record<string, string>;
}

type AuthedHandler = (req: NextRequest, ctx: AuthedContext) => Promise<NextResponse>;

export function withSession(
  handler: AuthedHandler,
): (req: NextRequest, nextCtx?: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, nextCtx) => {
    const session = await getServerSession(authOptions);
    const address = session?.user?.address as Address | undefined;

    if (!address) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await getMongoClientFromMongoose();
    attachDatabasePool(client);

    const params = nextCtx?.params ? await nextCtx.params : {};

    try {
      return await handler(req, { address, params });
    } catch (err) {
      if (err instanceof RouteAuthError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
  };
}

export function assertOwner<T extends { address: string }>(resource: T | null | undefined, callerAddress: Address): T {
  if (!resource) {
    throw new RouteAuthError(404, 'Not found');
  }
  if (resource.address.toLowerCase() !== callerAddress.toLowerCase()) {
    throw new RouteAuthError(403, 'Forbidden');
  }
  return resource;
}
