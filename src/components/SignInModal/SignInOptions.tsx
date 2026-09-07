'use client';

import { ArrowLeft, Fingerprint, Loader2, Mail, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { signIn } from 'next-auth/react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { DesktopGoogleSignInButton } from '@/components/DesktopGoogleSignInButton/DesktopGoogleSignInButton';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { SignInMethodButton } from '@/components/SignInMethodButton/SignInMethodButton';
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

/** Which screen the options are showing; the surrounding shell adapts to it. */
export type SignInView = 'list' | 'email' | 'passkey-failure';

type SignInOptionsProps = {
  /** Inside the Electron app: Google hands off to the system browser, the
   * email and wallet options run in place; passkeys stay browser-only. */
  isDesktop?: boolean;
  /** Where Google should land after the OAuth round-trip. Only meaningful in
   * a browser, where the flow leaves the page. */
  googleCallbackUrl?: string;
  /** Lets the host chrome (header rule, footer) follow the current step. */
  onViewChange?: (view: SignInView) => void;
};

/**
 * Every way into SigNote, in one list. The same browser options are offered in
 * the sign-in modal and on the browser page that authorizes the desktop app,
 * so a method added here reaches both.
 */
export function SignInOptions({ isDesktop = false, googleCallbackUrl, onViewChange }: SignInOptionsProps) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [passkeyOutcome, setPasskeyOutcome] = useState<'cancelled' | 'failed' | null>(null);
  const [passkeyAction, setPasskeyAction] = useState<'sign-in' | 'sign-up' | null>(null);
  const lastSignInMethod = useLastSignInMethod();
  const supportsPasskeys = usePasskeySupport();

  const view: SignInView = emailOpen ? 'email' : passkeyOutcome && !isDesktop ? 'passkey-failure' : 'list';

  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  const runPasskey = async (flow: 'sign-in' | 'sign-up') => {
    setPasskeyAction(flow);
    const outcome = await (flow === 'sign-in' ? signInWithPasskey() : signUpWithPasskey());
    setPasskeyAction(null);
    if (outcome === 'success') return;

    if (flow === 'sign-in') {
      setPasskeyOutcome(outcome);
      return;
    }

    toast.error(outcome === 'cancelled' ? 'Passkey account creation was cancelled.' : 'Could not create the account.');
  };

  // Picking email replaces the list rather than expanding inside it: the two
  // inputs and their button are the whole task now, and the other methods
  // would only be noise next to a code field. Back returns to the full list;
  // a code already sent survives the round trip (EmailCodeForm parks it).
  if (view === 'email') {
    return (
      <>
        <button type="button" className={s.backButton} onClick={() => setEmailOpen(false)} data-testid="sign-in-back">
          <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          Other ways to sign in
        </button>
        <EmailSignInForm isDesktop={isDesktop} />
      </>
    );
  }

  if (view === 'passkey-failure') {
    return (
      <>
        <button
          type="button"
          className={s.backButton}
          onClick={() => setPasskeyOutcome(null)}
          data-testid="passkey-failure-back"
        >
          <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          Other ways to sign in
        </button>

        <div className={s.passkeyFailure} role="status" aria-live="polite">
          <span className={s.passkeyFailureIcon}>
            <Fingerprint size={20} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div>
            <h3>
              {passkeyOutcome === 'cancelled'
                ? 'Passkey sign-in wasn’t completed'
                : 'We couldn’t sign you in with a passkey'}
            </h3>
            <p>
              Your passkey may be saved on another device or in a different password manager. Try again and choose “Use
              another device” if your browser offers it.
            </p>
          </div>
        </div>

        <Button
          onClick={() => void runPasskey('sign-in')}
          disabled={passkeyAction !== null}
          data-testid="passkey-retry-btn"
          className="h-[46px] w-full gap-2.5 rounded-[10px] text-[14.5px] font-medium"
        >
          {passkeyAction === 'sign-in' ? (
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
          ) : (
            <Fingerprint size={17} aria-hidden="true" />
          )}
          {passkeyAction === 'sign-in' ? 'Trying passkey…' : 'Try passkey again'}
        </Button>

        <div className={s.passkeyChoices}>
          <div className={s.passkeyWarning} role="note">
            <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
            <div>
              <strong>Already have a SigNote account?</strong>
              <p>
                A new account starts empty — it won’t have access to your existing notes. Retry your passkey on the
                device that created it, or go back to the other sign-in options.
              </p>
            </div>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={passkeyAction !== null}
                data-testid="passkey-create-account-btn"
                className="h-auto min-h-11 w-full rounded-[10px] px-4 py-2.5 text-sm font-medium whitespace-normal"
              >
                {passkeyAction === 'sign-up' ? 'Creating account…' : 'Create a new account with a passkey'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm" data-testid="passkey-create-account-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>Create a separate SigNote account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This creates a new, empty account. It will not connect to an existing account or recover existing
                  notes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Go back</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void runPasskey('sign-up')}
                  data-testid="passkey-confirm-create-account-btn"
                >
                  Create new account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </>
    );
  }

  return (
    <div className={s.methods}>
      {isDesktop ? (
        <DesktopGoogleSignInButton isLastUsed={lastSignInMethod === 'google'} />
      ) : (
        <SignInMethodButton
          onClick={() => {
            posthog.capture('sign_in_started', { method: 'google' });
            void signIn('google', googleCallbackUrl ? { callbackUrl: googleCallbackUrl } : undefined);
          }}
          data-testid="google-sign-in-btn"
          icon={<GoogleIcon />}
          isLastUsed={lastSignInMethod === 'google'}
        >
          Continue with Google
        </SignInMethodButton>
      )}

      <SignInMethodButton
        onClick={() => {
          posthog.capture('sign_in_started', { method: 'email', client: isDesktop ? 'desktop' : 'web' });
          setEmailOpen(true);
        }}
        data-testid="email-sign-in-btn"
        icon={<Mail size={18} strokeWidth={1.7} aria-hidden="true" />}
        isLastUsed={lastSignInMethod === 'email'}
      >
        Continue with email
      </SignInMethodButton>

      {!isDesktop && supportsPasskeys && (
        <SignInMethodButton
          onClick={() => void runPasskey('sign-in')}
          disabled={passkeyAction !== null}
          busy={passkeyAction === 'sign-in'}
          data-testid="passkey-sign-in-btn"
          icon={<Fingerprint size={18} strokeWidth={1.7} aria-hidden="true" />}
          isLastUsed={lastSignInMethod === 'passkey'}
        >
          Use a passkey
        </SignInMethodButton>
      )}

      <SiweSignInButton client={isDesktop ? 'desktop' : 'web'} isLastUsed={lastSignInMethod === 'siwe'} />
    </div>
  );
}
