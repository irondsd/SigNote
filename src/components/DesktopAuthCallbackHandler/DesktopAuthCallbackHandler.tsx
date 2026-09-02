'use client';

import { useEffect } from 'react';
import { getSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { getDesktopBridge } from '@/lib/desktop';
import {
  DesktopAuthError,
  exchangeDesktopAuthCallback,
  getPendingDesktopAuthCallback,
  saveDesktopAuthCallback,
  type DesktopAuthCallbackPayload,
} from '@/lib/desktopAuth';
import { emitDesktopAuthUiEvent } from '@/lib/desktopAuthEvents';

type DesktopAuthCallbackHandlerProps = {
  reload?: () => void;
};

const reloadWindow = () => window.location.reload();

export function DesktopAuthCallbackHandler({ reload = reloadWindow }: DesktopAuthCallbackHandlerProps = {}) {
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    let active = true;
    let inFlight = false;

    const exchange = async (payload: DesktopAuthCallbackPayload) => {
      if (inFlight) return;
      inFlight = true;
      saveDesktopAuthCallback(payload);
      emitDesktopAuthUiEvent({ state: 'exchanging' });

      try {
        await exchangeDesktopAuthCallback(payload);
        const session = await getSession({ broadcast: false });
        if (!session) {
          throw new DesktopAuthError(
            'The desktop session was created but could not be loaded. Please sign in again.',
            false,
          );
        }
        if (!active) return;
        posthog.capture('sign_in_completed', { method: 'google', client: 'desktop' });
        emitDesktopAuthUiEvent({ state: 'success' });
        reload();
      } catch (error) {
        if (!active) return;
        const message = error instanceof DesktopAuthError ? error.message : 'Desktop sign-in failed. Please try again.';
        posthog.capture('sign_in_failed', { method: 'google', client: 'desktop', reason: 'exchange_failed' });
        emitDesktopAuthUiEvent({ state: 'error', message });
      } finally {
        inFlight = false;
      }
    };

    const unsubscribe = bridge.onAuthCallback((payload) => void exchange(payload));
    const pendingCallback = getPendingDesktopAuthCallback();
    if (pendingCallback) void exchange(pendingCallback);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [reload]);

  return null;
}
