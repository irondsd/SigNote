/** @jest-environment jsdom */

import { getSessionClientHeaders, isPwaDisplayMode, parseWebSessionClient } from '@/lib/sessionClient';

const originalMatchMedia = window.matchMedia;

function setDisplayMode(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockReturnValue({ matches }),
  });
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: undefined });
  delete window.signoteDesktop;
});

describe('sessionClient', () => {
  it('recognizes standalone display mode and sends the PWA session hint', () => {
    setDisplayMode(true);

    expect(isPwaDisplayMode()).toBe(true);
    expect(getSessionClientHeaders()).toEqual({ 'x-signote-client': 'pwa' });
  });

  it('recognizes the iOS standalone navigator flag', () => {
    setDisplayMode(false);
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });

    expect(isPwaDisplayMode()).toBe(true);
  });

  it('does not label the Electron renderer as a PWA', () => {
    setDisplayMode(true);
    window.signoteDesktop = {
      isDesktop: true,
      platform: 'macos',
      appVersion: '1.0.0',
      startBrowserLogin: jest.fn().mockResolvedValue(undefined),
      onAuthCallback: () => () => undefined,
    };

    expect(getSessionClientHeaders()).toEqual({});
  });

  it('treats absent and unrecognized header values as ordinary web sessions', () => {
    expect(parseWebSessionClient('pwa')).toBe('pwa');
    expect(parseWebSessionClient('desktop')).toBe('web');
    expect(parseWebSessionClient(null)).toBe('web');
  });
});
