import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';

import { assertEraseToken, issueEraseToken, ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE } from '@/lib/eraseAuth';

const TEST_SECRET = 'test-secret-please-ignore-do-not-use-in-prod';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = TEST_SECRET;
});

describe('issueEraseToken', () => {
  it('signs a JWT that round-trips with NEXTAUTH_SECRET and contains userId and scope', () => {
    const token = issueEraseToken('user-1', ERASE_ALL_SCOPE);
    const decoded = jwt.verify(token, TEST_SECRET) as { userId: string; scope: string };
    expect(decoded.userId).toBe('user-1');
    expect(decoded.scope).toBe(ERASE_ALL_SCOPE);
  });

  it('uses a 15m expiration (exp - iat === 900s)', () => {
    const token = issueEraseToken('user-1', ERASE_ENCRYPTION_SCOPE);
    const decoded = jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });
});

describe('assertEraseToken', () => {
  // Captures the thrown TRPCError so its code/message can be asserted.
  function caught(fn: () => void): TRPCError | null {
    try {
      fn();
      return null;
    } catch (e) {
      return e as TRPCError;
    }
  }

  it('throws UNAUTHORIZED when the token has a bad signature', () => {
    const bad = jwt.sign({ userId: 'user-1', scope: ERASE_ALL_SCOPE }, 'wrong-secret', { expiresIn: '15m' });
    const err = caught(() => assertEraseToken(bad, 'user-1', [ERASE_ALL_SCOPE]));
    expect(err?.code).toBe('UNAUTHORIZED');
    expect(err?.message).toBe('Invalid or expired erase token');
  });

  it('throws UNAUTHORIZED when the token is expired', () => {
    const expired = jwt.sign({ userId: 'user-1', scope: ERASE_ALL_SCOPE }, TEST_SECRET, { expiresIn: '-1s' });
    const err = caught(() => assertEraseToken(expired, 'user-1', [ERASE_ALL_SCOPE]));
    expect(err?.code).toBe('UNAUTHORIZED');
  });

  it('throws FORBIDDEN when the scope does not match', () => {
    const token = issueEraseToken('user-1', ERASE_ENCRYPTION_SCOPE);
    const err = caught(() => assertEraseToken(token, 'user-1', [ERASE_ALL_SCOPE]));
    expect(err?.code).toBe('FORBIDDEN');
    expect(err?.message).toBe('Invalid token scope');
  });

  it('throws FORBIDDEN when scope is not in the allowed set', () => {
    const token = issueEraseToken('user-1', 'unknown-scope');
    const err = caught(() => assertEraseToken(token, 'user-1', [ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE]));
    expect(err?.code).toBe('FORBIDDEN');
  });

  it('throws FORBIDDEN when the token userId does not match the caller', () => {
    const token = issueEraseToken('user-2', ERASE_ALL_SCOPE);
    const err = caught(() => assertEraseToken(token, 'user-1', [ERASE_ALL_SCOPE]));
    expect(err?.code).toBe('FORBIDDEN');
    expect(err?.message).toBe('Token user mismatch');
  });

  it('passes for a valid token with a matching single scope', () => {
    const token = issueEraseToken('user-1', ERASE_ALL_SCOPE);
    expect(caught(() => assertEraseToken(token, 'user-1', [ERASE_ALL_SCOPE]))).toBeNull();
  });

  it('passes when the scope is one of several allowed', () => {
    const token = issueEraseToken('user-1', ERASE_ENCRYPTION_SCOPE);
    expect(caught(() => assertEraseToken(token, 'user-1', [ERASE_ALL_SCOPE, ERASE_ENCRYPTION_SCOPE]))).toBeNull();
  });
});
