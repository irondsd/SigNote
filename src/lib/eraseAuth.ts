import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';

export const ERASE_ALL_SCOPE = 'erase-all';
export const ERASE_ENCRYPTION_SCOPE = 'erase-encryption';

export interface EraseTokenPayload {
  userId: string;
  scope: string;
}

export function issueEraseToken(userId: string, scope: string): string {
  return jwt.sign({ userId, scope }, process.env.NEXTAUTH_SECRET!, {
    expiresIn: '15m',
  });
}

/** Verifies an erase token's signature/expiry. Returns the payload or null. */
export function verifyEraseToken(token: string): EraseTokenPayload | null {
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET!) as EraseTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Re-confirmation gate for the erase procedures: the short-lived scoped JWT must
 * be valid, carry one of the allowed scopes, and belong to the calling user.
 * Throws a `TRPCError` (UNAUTHORIZED / FORBIDDEN) on any failure.
 */
export function assertEraseToken(token: string, userId: string, scopes: readonly string[]): void {
  const payload = verifyEraseToken(token);
  if (!payload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired erase token' });
  if (!scopes.includes(payload.scope)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid token scope' });
  if (payload.userId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Token user mismatch' });
}
