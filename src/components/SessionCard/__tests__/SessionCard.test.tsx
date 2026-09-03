/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { SessionCard } from '@/components/SessionCard/SessionCard';
import type { SessionRow } from '@/hooks/useSessions';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
});

const session = (client: SessionRow['client']): SessionRow => ({
  _id: 'session-1',
  provider: 'google',
  client,
  ip: '127.0.0.1',
  browser: 'Chrome 120',
  os: 'macOS 14',
  deviceType: 'desktop',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  current: false,
});

describe('SessionCard', () => {
  it('shows a PWA badge for installed web app sessions', () => {
    render(<SessionCard session={session('pwa')} onRevoke={jest.fn()} isRevoking={false} />);

    expect(screen.getByText('PWA')).toBeTruthy();
    expect(screen.getByText(/Chrome 120/)).toBeTruthy();
  });

  it('does not show a PWA badge for ordinary web sessions', () => {
    render(<SessionCard session={session('web')} onRevoke={jest.fn()} isRevoking={false} />);

    expect(screen.queryByText('PWA')).toBeNull();
  });
});
