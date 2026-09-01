/** @jest-environment jsdom */

import { getDesktopBridge, isDesktopApp } from '@/lib/desktop';

describe('desktop environment detection', () => {
  afterEach(() => {
    delete window.signoteDesktop;
  });

  it('returns the immutable preload bridge when Electron provides it', () => {
    const bridge: SigNoteDesktopBridge = {
      isDesktop: true,
      platform: 'macos',
      appVersion: '0.1.0',
      startBrowserLogin: jest.fn().mockResolvedValue(undefined),
    };
    window.signoteDesktop = bridge;

    expect(getDesktopBridge()).toBe(bridge);
    expect(isDesktopApp()).toBe(true);
  });

  it('treats an ordinary browser as the web application', () => {
    expect(getDesktopBridge()).toBeNull();
    expect(isDesktopApp()).toBe(false);
  });
});
