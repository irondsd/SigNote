import { resolveSignInClient } from '@/lib/authClient';

describe('resolveSignInClient', () => {
  it('labels a desktop SIWE credentials session as desktop', () => {
    expect(resolveSignInClient('credentials', 'desktop')).toBe('desktop');
  });

  it('defaults missing and unrecognized hints to web', () => {
    expect(resolveSignInClient('credentials', undefined)).toBe('web');
    expect(resolveSignInClient('credentials', 'native')).toBe('web');
  });

  it('does not apply the credentials hint to OAuth providers', () => {
    expect(resolveSignInClient('google', 'desktop')).toBe('web');
  });
});
