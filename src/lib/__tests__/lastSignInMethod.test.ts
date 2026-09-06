/**
 * @jest-environment jsdom
 */

import { getLastSignInMethod, LAST_SIGN_IN_METHOD_KEY, rememberLastSignInMethod } from '@/lib/lastSignInMethod';

describe('last sign-in method', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the latest successful method', () => {
    rememberLastSignInMethod('google');
    expect(getLastSignInMethod()).toBe('google');

    rememberLastSignInMethod('siwe');
    expect(getLastSignInMethod()).toBe('siwe');
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem(LAST_SIGN_IN_METHOD_KEY, 'future-provider');
    expect(getLastSignInMethod()).toBeNull();
  });
});
