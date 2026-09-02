'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Monitor, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { Logo } from '@/components/Logo/Logo';
import s from './page.module.scss';

type AuthorizeState = 'idle' | 'authorizing' | 'ready' | 'error' | 'google_required';

export function DesktopLogin() {
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [authorizeState, setAuthorizeState] = useState<AuthorizeState>('idle');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const attemptId = searchParams.get('attempt');
  const state = searchParams.get('state');
  const isValidRequest = !!attemptId && !!state;

  const continueWithGoogle = () => {
    void signIn('google', { callbackUrl: window.location.href });
  };

  const authorize = async () => {
    if (!attemptId || !state) return;
    setAuthorizeState('authorizing');

    try {
      const response = await fetch('/api/desktop-auth/authorize', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId, state }),
      });
      const body = (await response.json().catch(() => ({}))) as { deepLink?: string };

      if (response.status === 403) {
        setAuthorizeState('google_required');
        return;
      }
      if (!response.ok || !body.deepLink) {
        setAuthorizeState('error');
        return;
      }

      setDeepLink(body.deepLink);
      setAuthorizeState('ready');
      window.location.assign(body.deepLink);
    } catch {
      setAuthorizeState('error');
    }
  };

  const isLoading = status === 'loading';
  const isSignedIn = status === 'authenticated';

  return (
    <div className={s.content}>
      <Logo className={s.logo} />

      <Card className={s.card} aria-busy={isLoading || authorizeState === 'authorizing'}>
        <CardHeader className={s.header}>
          <div className={s.deviceMark} aria-hidden="true">
            <Monitor size={26} strokeWidth={1.6} />
          </div>
          <CardTitle className={s.title}>Authorize SigNote Desktop</CardTitle>
          <CardDescription className={s.description}>
            Sign in securely in this browser, then return to the desktop app.
          </CardDescription>
        </CardHeader>

        <CardContent className={s.body}>
          {!isValidRequest ? (
            <div className={s.feedback} role="alert">
              <TriangleAlert aria-hidden="true" />
              <div>
                <strong>This desktop sign-in link is invalid.</strong>
                <p>Return to SigNote Desktop and start again.</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className={s.centerStatus} role="status">
              <Loader2 aria-hidden="true" className="animate-spin" />
              Checking your browser session…
            </div>
          ) : !isSignedIn || authorizeState === 'google_required' ? (
            <>
              {authorizeState === 'google_required' && (
                <div className={s.feedback} role="alert">
                  <KeyRound aria-hidden="true" />
                  <div>
                    <strong>Google sign-in is required for this desktop release.</strong>
                    <p>You can continue with a different Google account below.</p>
                  </div>
                </div>
              )}
              <Button
                type="button"
                onClick={continueWithGoogle}
                data-testid="desktop-browser-google-sign-in"
                className={s.googleButton}
              >
                <GoogleIcon />
                Continue with Google
              </Button>
            </>
          ) : authorizeState === 'ready' && deepLink ? (
            <div className={s.success} role="status" aria-live="polite">
              <CheckCircle2 aria-hidden="true" />
              <h2>SigNote Desktop is ready</h2>
              <p>You can return to the app and close this browser tab.</p>
              <Button asChild className={s.primaryAction}>
                <a href={deepLink} data-testid="open-signote-desktop">
                  Open SigNote Desktop
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </div>
          ) : authorizeState === 'error' ? (
            <div className={s.feedback} role="alert">
              <TriangleAlert aria-hidden="true" />
              <div>
                <strong>This request expired or could not be authorized.</strong>
                <p>Return to SigNote Desktop and try signing in again.</p>
              </div>
            </div>
          ) : (
            <>
              <div className={s.accountRow}>
                <ShieldCheck aria-hidden="true" />
                <div>
                  <span>Signed in as</span>
                  <strong>{session.user?.email ?? session.user?.name ?? 'your SigNote account'}</strong>
                </div>
              </div>
              <p className={s.disclosure}>
                This creates a separate desktop session. You can review or revoke it later from Active sessions.
              </p>
              <Button
                type="button"
                onClick={authorize}
                disabled={authorizeState === 'authorizing'}
                className={s.primaryAction}
                data-testid="authorize-signote-desktop"
              >
                {authorizeState === 'authorizing' ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Monitor aria-hidden="true" />
                )}
                {authorizeState === 'authorizing' ? 'Authorizing…' : 'Authorize desktop app'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <p className={s.securityNote}>
        <ShieldCheck aria-hidden="true" />
        Your Google credentials are never shared with the desktop app.
      </p>
    </div>
  );
}
