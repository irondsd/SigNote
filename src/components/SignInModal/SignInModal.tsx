'use client';

import { Mail, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { signIn, useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { DesktopGoogleSignInButton } from '@/components/DesktopGoogleSignInButton/DesktopGoogleSignInButton';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { useDesktopApp } from '@/hooks/useDesktopApp';
import { EmailCodeForm } from '@/components/EmailCodeForm/EmailCodeForm';
import { errorCode, useRequestSignInCode } from '@/hooks/useEmailAuth';
import s from './SignInModal.module.scss';

const SiweSignInButton = dynamic(
  () => import('@/components/SiweSignInButton/SiweSignInButton').then((module) => module.SiweSignInButton),
  { ssr: false },
);

type SignInModalProps = {
  onClose: () => void;
};

/**
 * Wrong code, expired code and no-code-requested are one message on purpose:
 * the server won't say which, because the difference only helps a guesser.
 */
const describeSignInError = (err: unknown, step: 'request' | 'verify') => {
  const code = errorCode(err);
  if (code.includes('Too many')) return code;
  return step === 'request'
    ? 'Could not send a code. Check the address and try again.'
    : 'That code is not valid. Request a new one.';
};

export function SignInModal({ onClose }: SignInModalProps) {
  const isDesktop = useDesktopApp();
  const { status } = useSession();
  const [emailOpen, setEmailOpen] = useState(false);
  const { mutateAsync: requestCode } = useRequestSignInCode();

  const emailBlock = emailOpen ? (
    <EmailCodeForm
      testIdPrefix="signin-email"
      submitLabel="Sign in"
      describeError={describeSignInError}
      onRequestCode={(email) => requestCode(email)}
      onSubmitCode={async (email, code) => {
        const result = await signIn('email-otp', {
          email,
          code,
          client: isDesktop ? 'desktop' : 'web',
          redirect: false,
        });
        // NextAuth turns a null from `authorize` into ok:false rather than a
        // throw, so the form only learns about it if we throw here.
        if (!result?.ok) throw new Error('BAD_CODE');
        posthog.capture('sign_in_completed', { method: 'email' });
      }}
    />
  ) : (
    <Button
      variant="outline"
      onClick={() => {
        posthog.capture('sign_in_started', { method: 'email' });
        setEmailOpen(true);
      }}
      data-testid="email-sign-in-btn"
      className="w-full h-11 rounded-lg font-medium flex items-center gap-3 px-4"
    >
      <Mail size={18} />
      Continue with email
    </Button>
  );

  useEffect(() => {
    if (isDesktop && status === 'authenticated') onClose();
  }, [isDesktop, onClose, status]);

  return (
    <Backdrop onClose={onClose}>
      <Modal className={s.modal}>
        <div className={s.header}>
          <h2 className={s.heading}>Sign in to SigNote</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close" aria-label="Close">
            <X size={18} />
          </Button>
        </div>

        <div className={s.body}>
          {isDesktop ? (
            <>
              <DesktopGoogleSignInButton />

              <div className={s.divider}>
                <span>or</span>
              </div>

              {emailBlock}

              <SiweSignInButton client="desktop" />
            </>
          ) : (
            <>
              <Button
                onClick={() => {
                  posthog.capture('sign_in_started', { method: 'google' });
                  signIn('google');
                }}
                data-testid="google-sign-in-btn"
                className="w-full bg-white text-zinc-800 hover:bg-zinc-100 border border-zinc-200 rounded-lg h-11 font-medium flex items-center gap-3 px-4"
              >
                <GoogleIcon />
                Sign in with Google
              </Button>

              <div className={s.divider}>
                <span>or</span>
              </div>

              {emailBlock}

              <SiweSignInButton />
            </>
          )}
        </div>
      </Modal>
    </Backdrop>
  );
}
