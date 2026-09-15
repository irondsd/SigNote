import { describeAuthError } from '@/lib/authErrors';

describe('describeAuthError', () => {
  it('maps a known code to its copy', () => {
    expect(describeAuthError('ROTATION_IN_PROGRESS')).toMatchObject({
      title: 'Encryption keys are being rotated',
      code: 'ROTATION_IN_PROGRESS',
    });
  });

  it('falls back to generic copy for an unknown code, keeping the code for bug reports', () => {
    expect(describeAuthError('SomethingNew')).toMatchObject({ title: 'Sign-in failed', code: 'SomethingNew' });
  });

  it('falls back when no code is given', () => {
    expect(describeAuthError(undefined)).toMatchObject({ title: 'Sign-in failed', code: null });
  });

  it('never echoes back text that is not shaped like a code', () => {
    const result = describeAuthError('Your account is suspended. Visit evil.example');
    expect(result.code).toBeNull();
    expect(result.title).toBe('Sign-in failed');
  });

  it('ignores inherited object keys', () => {
    expect(describeAuthError('constructor')).toMatchObject({ title: 'Sign-in failed' });
  });

  it('uses the first value of a repeated parameter', () => {
    expect(describeAuthError(['AccessDenied', 'Configuration']).title).toBe('Access denied');
  });
});
