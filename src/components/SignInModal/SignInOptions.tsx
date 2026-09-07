'use client';

import { ArrowLeft, Fingerprint, Loader2, Mail } from 'lucide-react';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { signIn } from 'next-auth/react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { DesktopGoogleSignInButton } from '@/components/DesktopGoogleSignInButton/DesktopGoogleSignInButton';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { SignInMethodButtonContent } from '@/components/LastUsedBadge/LastUsedBadge';
import { useLastSignInMethod } from '@/hooks/useLastSignInMethod';
import { usePasskeySupport } from '@/hooks/usePasskeys';
import { signInWithPasskey, signUpWithPasskey } from '@/lib/passkeyClient';
import { toast } from 'sonner';
import s from './SignInModal.module.scss';

// Loaded on demand: see the note in EmailSignInForm about keeping the tRPC
// client off the signed-out page's critical path.
const EmailSignInForm = dynamic(() => import('./EmailSignInForm'), { ssr: false });

const SiweSignInButton = dynamic(
  () => import('@/components/SiweSignInButton/SiweSignInButton').then((module) => module.SiweSignInButton),
  { ssr: false },
);

type SignInOptionsProps = {
  /** Inside the Electron app: Google hands off to the system browser, the
   * email and wallet options run in place; passkeys stay browser-only. */
  isDesktop?: boolean;
  /** Where Google should land after the OAuth round-trip. Only meaningful in
   * a browser, where the flow leaves the page. */
  googleCallbackUrl?: string;
};

/**
 * Every way into SigNote, in one list. The same browser options are offered in
 * the sign-in modal and on the browser page that authorizes the desktop app,
 * so a method added here reaches both.
 */
export function SignInOptions({ isDesktop = false, googleCallbackUrl }: SignInOptionsProps) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [passkeyAction, setPasskeyAction] = useState<'sign-in' | 'sign-up' | null>(null);
  const lastSignInMethod = useLastSignInMethod();
  const supportsPasskeys = usePasskeySupport();

  const runPasskey = async (flow: 'sign-in' | 'sign-up') => {
    setPasskeyAction(flow);
    const outcome = await (flow === 'sign-in' ? signInWithPasskey() : signUpWithPasskey());
    setPasskeyAction(null);
    if (outcome === 'failed') toast.error('Passkey sign-in failed. Please try again.');
  };

  // Picking email replaces the list rather than expanding inside it: the two
  // inputs and their button are the whole task now, and the other methods
  // would only be noise next to a code field. Back returns to the full list;
  // a code already sent survives the round trip (EmailCodeForm parks it).
  if (emailOpen) {
    return (
      <>
        <button type="button" className={s.backButton} onClick={() => setEmailOpen(false)} data-testid="sign-in-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Other ways to sign in
        </button>
        <EmailSignInForm isDesktop={isDesktop} />
      </>
    );
  }

  return (
    <>
      {isDesktop ? (
        <DesktopGoogleSignInButton isLastUsed={lastSignInMethod === 'google'} />
      ) : (
        <Button
          onClick={() => {
            posthog.capture('sign_in_started', { method: 'google' });
            void signIn('google', googleCallbackUrl ? { callbackUrl: googleCallbackUrl } : undefined);
          }}
          data-testid="google-sign-in-btn"
          className="w-full bg-white text-zinc-800 hover:bg-zinc-100 border border-zinc-200 rounded-lg h-11 font-medium flex items-center gap-3 px-4"
        >
          <SignInMethodButtonContent icon={<GoogleIcon />} isLastUsed={lastSignInMethod === 'google'}>
            Sign in with Google
          </SignInMethodButtonContent>
        </Button>
      )}

      {!isDesktop && supportsPasskeys && (
        <>
          <Button
            variant="outline"
            onClick={() => void runPasskey('sign-in')}
            disabled={passkeyAction !== null}
            data-testid="passkey-sign-in-btn"
            className="w-full h-11 rounded-lg font-medium flex items-center gap-3 px-4"
          >
            <SignInMethodButtonContent
              icon={
                passkeyAction === 'sign-in' ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Fingerprint size={18} aria-hidden="true" />
                )
              }
              isLastUsed={lastSignInMethod === 'passkey'}
            >
              Sign in with a passkey
            </SignInMethodButtonContent>
          </Button>
          <button
            type="button"
            className={s.passkeySignup}
            onClick={() => void runPasskey('sign-up')}
            disabled={passkeyAction !== null}
            data-testid="passkey-sign-up-btn"
          >
            {passkeyAction === 'sign-up' ? 'Creating passkey…' : 'Create a passkey instead'}
          </button>
        </>
      )}

      <div className={s.divider}>
        <span>or</span>
      </div>

      <Button
        variant="outline"
        onClick={() => {
          posthog.capture('sign_in_started', { method: 'email', client: isDesktop ? 'desktop' : 'web' });
          setEmailOpen(true);
        }}
        data-testid="email-sign-in-btn"
        className="w-full h-11 rounded-lg font-medium flex items-center gap-3 px-4"
      >
        <SignInMethodButtonContent icon={<Mail size={18} />} isLastUsed={lastSignInMethod === 'email'}>
          Continue with email
        </SignInMethodButtonContent>
      </Button>

      <SiweSignInButton client={isDesktop ? 'desktop' : 'web'} isLastUsed={lastSignInMethod === 'siwe'} />
    </>
  );
}
