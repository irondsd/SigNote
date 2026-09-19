import { registerStableKey, getStableKey, clearStableKeys } from '@/lib/stableKeyStore';
import { setActiveAccountId } from '@/lib/accountScope';

beforeEach(() => {
  setActiveAccountId(null);
  clearStableKeys();
});

afterEach(() => setActiveAccountId(null));

describe('stableKeyStore', () => {
  it('getStableKey returns the input id when nothing is registered', () => {
    expect(getStableKey('unregistered-id-1')).toBe('unregistered-id-1');
  });

  it('returns the registered stableKey after registerStableKey', () => {
    registerStableKey('real-id-2', 'stable-key-2');
    expect(getStableKey('real-id-2')).toBe('stable-key-2');
  });

  it('overwrites a previously registered key for the same realId', () => {
    registerStableKey('real-id-3', 'first');
    registerStableKey('real-id-3', 'second');
    expect(getStableKey('real-id-3')).toBe('second');
  });

  it('registrations are isolated per realId', () => {
    registerStableKey('real-id-4a', 'AA');
    registerStableKey('real-id-4b', 'BB');
    expect(getStableKey('real-id-4a')).toBe('AA');
    expect(getStableKey('real-id-4b')).toBe('BB');
    expect(getStableKey('unregistered-id-4c')).toBe('unregistered-id-4c');
  });

  it('does not reuse a key for the same portable id in another account', () => {
    setActiveAccountId('alice');
    registerStableKey('same-id', 'alice-card');
    expect(getStableKey('same-id')).toBe('alice-card');

    setActiveAccountId('bob');
    expect(getStableKey('same-id')).toBe('same-id');
  });
});
