import { TRPCError } from '@trpc/server';

/**
 * tRPC equivalent of `assertOwner` from routeAuth: 404 if the resource is
 * missing, 403 if it belongs to someone else, otherwise narrows the type.
 */
export function assertOwner<T extends { userId: string }>(resource: T | null | undefined, callerId: string): T {
  if (!resource) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
  }
  if (resource.userId !== callerId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Forbidden' });
  }
  return resource;
}
