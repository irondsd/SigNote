'use client';

import { ArrowLeft, Fingerprint, Loader2, Mail, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
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
  const [passkeyFailed, setPasskeyFailed] = useState(false);
  const [passkeyAction, setPasskeyAction] = useState<'sign-in' | 'sign-up' | null>(null);
  const lastSignInMethod = useLastSignInMethod();
  const supportsPasskeys = usePasskeySupport();

  const runPasskey = async (flow: 'sign-in' | 'sign-up') => {
    setPasskeyAction(flow);
    const outcome = await (flow === 'sign-in' ? signInWithPasskey() : signUpWithPasskey());
    setPasskeyAction(null);
    if (outcome === 'success') return;

    if (flow === 'sign-in') {
      setPasskeyFailed(true);
      return;
    }

    toast.error(outcome === 'cancelled' ? 'Passkey account creation was cancelled.' : 'Could not create the account.');
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

  if (passkeyFailed && !isDesktop) {
    return (
      <>
        <button
          type="button"
          className={s.backButton}
          onClick={() => setPasskeyFailed(false)}
          data-testid="passkey-failure-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Other ways to sign in
        </button>

        <div className={s.passkeyFailure} role="status" aria-live="polite">
          <span className={s.passkeyFailureIcon}>
            <Fingerprint size={22} aria-hidden="true" />
          </span>
          <div>
            <h3>We couldn’t sign you in with a passkey</h3>
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
          className="w-full h-11 rounded-lg font-medium flex items-center gap-2 px-4"
        >
          {passkeyAction === 'sign-in' ? (
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Fingerprint size={18} aria-hidden="true" />
          )}
          {passkeyAction === 'sign-in' ? 'Trying passkey…' : 'Try passkey again'}
        </Button>

        <div className={s.passkeyWarning} role="note">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Already have a SigNote account?</strong>
            <p>
              Don’t create a new account. Try your passkey again using another device, or return to the other sign-in
              options. A new account will not have access to your existing notes.
            </p>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              disabled={passkeyAction !== null}
              data-testid="passkey-create-account-btn"
              className="w-full min-h-11 h-auto rounded-lg font-medium whitespace-normal px-4 py-2.5"
            >
              {passkeyAction === 'sign-up' ? 'Creating account…' : 'Create a new account with a passkey'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent size="sm" data-testid="passkey-create-account-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Create a separate SigNote account?</AlertDialogTitle>
              <AlertDialogDescription>
                This creates a new, empty account. It will not connect to an existing account or recover existing notes.
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
            Continue with a passkey
          </SignInMethodButtonContent>
        </Button>
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
