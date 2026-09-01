/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import posthog from 'posthog-js';
import { DesktopGoogleSignInButton } from '../DesktopGoogleSignInButton';

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { capture: jest.fn() },
}));

describe('<DesktopGoogleSignInButton />', () => {
  const capture = jest.mocked(posthog.capture);

  afterEach(() => {
    delete window.signoteDesktop;
    jest.clearAllMocks();
  });

  it('opens the constrained browser-login URL and displays a waiting state', async () => {
    const startBrowserLogin = jest.fn().mockResolvedValue(undefined);
    window.signoteDesktop = {
      isDesktop: true,
      platform: 'macos',
      appVersion: '0.1.0',
      startBrowserLogin,
    };

    render(<DesktopGoogleSignInButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(startBrowserLogin).toHaveBeenCalledWith('http://localhost/desktop/login'));
    expect(screen.getByRole('button', { name: 'Waiting for browser…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Finish signing in in your browser');
    expect(capture).toHaveBeenCalledWith('sign_in_started', { method: 'google', client: 'desktop' });
  });

  it('shows an actionable inline error when opening the browser fails', async () => {
    window.signoteDesktop = {
      isDesktop: true,
      platform: 'macos',
      appVersion: '0.1.0',
      startBrowserLogin: jest.fn().mockRejectedValue(new Error('open failed')),
    };

    render(<DesktopGoogleSignInButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't open your browser");
    expect(screen.getByRole('button', { name: 'Try opening browser again' })).toBeEnabled();
    expect(capture).toHaveBeenCalledWith('sign_in_failed', {
      method: 'google',
      client: 'desktop',
      reason: 'browser_open_failed',
    });
  });
});
