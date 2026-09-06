/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react';
import { useAutoLock } from '../useAutoLock';

const softLock = jest.fn();
const lock = jest.fn();

jest.mock('@/contexts/EncryptionContext', () => ({
  useEncryption: () => ({ phase: 'unlocked', lockType: 'none', softLock, lock }),
}));

function hide() {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function pagehide(persisted: boolean) {
  const e = new Event('pagehide') as Event & { persisted: boolean };
  Object.defineProperty(e, 'persisted', { value: persisted });
  window.dispatchEvent(e);
}

describe('useAutoLock — soft lock on tab hidden', () => {
  beforeEach(() => {
    softLock.mockClear();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('soft locks when the tab is hidden', () => {
    renderHook(() => useAutoLock());
    hide();
    expect(softLock).toHaveBeenCalledTimes(1);
  });

  // A document on its way out fires pagehide and then visibilitychange → hidden.
  // Soft locking there is deliberate: a reload must land in the same state as a
  // tab you walked away from, not resume an unlocked vault. The timestamp it
  // leaves in sessionStorage is what carries the 5-minute hard-lock escalation
  // across the reload, so do not exempt the unload path.
  it('soft locks while the document is unloading', () => {
    renderHook(() => useAutoLock());
    pagehide(false);
    hide();
    expect(softLock).toHaveBeenCalledTimes(1);
  });

  it('soft locks when the page enters the bfcache', () => {
    renderHook(() => useAutoLock());
    pagehide(true);
    hide();
    expect(softLock).toHaveBeenCalledTimes(1);
  });
});
