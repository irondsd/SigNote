/** @jest-environment jsdom */

import { act, render, waitFor } from '@testing-library/react';
import { getSession } from 'next-auth/react';
import { getDesktopBridge } from '@/lib/desktop';
import { exchangeDesktopAuthCallback } from '@/lib/desktopAuth';
import { emitDesktopAuthUiEvent } from '@/lib/desktopAuthEvents';
import { DesktopAuthCallbackHandler } from '../DesktopAuthCallbackHandler';

jest.mock('next-auth/react', () => ({ getSession: jest.fn() }));
jest.mock('posthog-js', () => ({ capture: jest.fn() }));
jest.mock('@/lib/desktop', () => ({ getDesktopBridge: jest.fn() }));
jest.mock('@/lib/desktopAuth', () => {
  const actual = jest.requireActual('@/lib/desktopAuth');
  return {
    ...actual,
    exchangeDesktopAuthCallback: jest.fn(),
    getPendingDesktopAuthCallback: jest.fn(() => null),
    saveDesktopAuthCallback: jest.fn(),
  };
});
jest.mock('@/lib/desktopAuthEvents', () => ({ emitDesktopAuthUiEvent: jest.fn() }));

const callback = {
  attemptId: 'a'.repeat(32),
  code: 'b'.repeat(43),
  state: 'c'.repeat(43),
};

describe('DesktopAuthCallbackHandler', () => {
  let receiveCallback: ((payload: typeof callback) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    receiveCallback = undefined;
    (getDesktopBridge as jest.Mock).mockReturnValue({
      onAuthCallback: (listener: (payload: typeof callback) => void) => {
        receiveCallback = listener;
        return jest.fn();
      },
    });
    (exchangeDesktopAuthCallback as jest.Mock).mockResolvedValue(undefined);
  });

  it('verifies the issued session and reloads the current renderer', async () => {
    const reload = jest.fn();
    (getSession as jest.Mock).mockResolvedValue({ user: { id: 'user-id' } });
    render(<DesktopAuthCallbackHandler reload={reload} />);

    await act(async () => receiveCallback?.(callback));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(getSession).toHaveBeenCalledWith({ broadcast: false });
    expect(emitDesktopAuthUiEvent).toHaveBeenCalledWith({ state: 'success' });
  });

  it('does not reload when the new cookie cannot be resolved to a session', async () => {
    const reload = jest.fn();
    (getSession as jest.Mock).mockResolvedValue(null);
    render(<DesktopAuthCallbackHandler reload={reload} />);

    await act(async () => receiveCallback?.(callback));

    await waitFor(() => expect(emitDesktopAuthUiEvent).toHaveBeenCalledWith(expect.objectContaining({ state: 'error' })));
    expect(reload).not.toHaveBeenCalled();
  });
});
