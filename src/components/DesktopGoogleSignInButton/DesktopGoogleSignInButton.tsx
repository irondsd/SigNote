'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { getDesktopBridge } from '@/lib/desktop';
import s from './DesktopGoogleSignInButton.module.scss';

type BrowserLoginState = 'idle' | 'opening' | 'waiting' | 'error';

export function DesktopGoogleSignInButton() {
  const [state, setState] = useState<BrowserLoginState>('idle');

  const startBrowserLogin = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setState('error');
      return;
    }

    setState('opening');
    posthog.capture('sign_in_started', { method: 'google', client: 'desktop' });

    try {
      await bridge.startBrowserLogin(new URL('/desktop/login', window.location.origin).href);
      setState('waiting');
    } catch {
      posthog.capture('sign_in_failed', { method: 'google', client: 'desktop', reason: 'browser_open_failed' });
      setState('error');
    }
  };

  const isPending = state === 'opening' || state === 'waiting';
  const label =
    state === 'opening'
      ? 'Opening browser…'
      : state === 'waiting'
        ? 'Waiting for browser…'
        : state === 'error'
          ? 'Try opening browser again'
          : 'Continue with Google';

  return (
    <div className={s.container} aria-busy={isPending}>
      <Button
        type="button"
        onClick={startBrowserLogin}
        disabled={isPending}
        data-testid="desktop-google-sign-in-btn"
        className="w-full bg-white text-zinc-800 hover:bg-zinc-100 border border-zinc-200 rounded-lg h-11 font-medium flex items-center gap-3 px-4"
      >
        {isPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <GoogleIcon />}
        {label}
      </Button>

      {state === 'waiting' && (
        <p className={s.message} role="status" aria-live="polite">
          Finish signing in in your browser, then return to SigNote.
        </p>
      )}
      {state === 'error' && (
        <p className={s.error} role="alert">
          SigNote couldn&apos;t open your browser. Please try again.
        </p>
      )}
    </div>
  );
}
