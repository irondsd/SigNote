/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useDesktopApp } from '@/hooks/useDesktopApp';

function DesktopModeProbe() {
  return <span>{useDesktopApp() ? 'desktop' : 'web'}</span>;
}

describe('useDesktopApp', () => {
  afterEach(() => {
    delete window.signoteDesktop;
  });

  it('uses the no-wallet desktop tree for server rendering', () => {
    expect(renderToString(<DesktopModeProbe />)).toContain('desktop');
  });

  it('selects web mode in an ordinary hydrated browser', () => {
    render(<DesktopModeProbe />);
    expect(screen.getByText('web')).toBeTruthy();
  });

  it('keeps desktop mode when the preload bridge is present', () => {
    window.signoteDesktop = {
      isDesktop: true,
      platform: 'macos',
      appVersion: '0.1.0',
      startBrowserLogin: jest.fn().mockResolvedValue(undefined),
      onAuthCallback: () => () => undefined,
    };

    render(<DesktopModeProbe />);
    expect(screen.getByText('desktop')).toBeTruthy();
  });
});
