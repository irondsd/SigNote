'use client';

import { Mail } from 'lucide-react';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { signIn } from 'next-auth/react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { DesktopGoogleSignInButton } from '@/components/DesktopGoogleSignInButton/DesktopGoogleSignInButton';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { SignInMethodButtonContent } from '@/components/LastUsedBadge/LastUsedBadge';
import { useLastSignInMethod } from '@/hooks/useLastSignInMethod';
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
   * other two run in place and label their session as desktop. */
  isDesktop?: boolean;
  /** Where Google should land after the OAuth round-trip. Only meaningful in
   * a browser, where the flow leaves the page. */
  googleCallbackUrl?: string;
};

/**
 * Every way into SigNote, in one list. The same three options are offered in
 * the sign-in modal and on the browser page that authorizes the desktop app,
 * so a method added here reaches both.
 */
export function SignInOptions({ isDesktop = false, googleCallbackUrl }: SignInOptionsProps) {
  const [emailOpen, setEmailOpen] = useState(false);
  const lastSignInMethod = useLastSignInMethod();

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

      <div className={s.divider}>
        <span>or</span>
      </div>

      {emailOpen ? (
        <EmailSignInForm isDesktop={isDesktop} />
      ) : (
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
      )}

      <SiweSignInButton client={isDesktop ? 'desktop' : 'web'} isLastUsed={lastSignInMethod === 'siwe'} />
    </>
  );
}
