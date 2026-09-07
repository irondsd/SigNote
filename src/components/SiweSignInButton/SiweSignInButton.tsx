'use client';

import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import '@rainbow-me/rainbowkit/styles.css';
import { useSiweSign } from '@/hooks/useSiweSign';
import { EthereumIcon } from '../icons/SignInIcons';
import { SignInMethodButton } from '@/components/SignInMethodButton/SignInMethodButton';

export function SiweSignInButton({
  client = 'web',
  isLastUsed = false,
}: {
  client?: 'web' | 'desktop';
  isLastUsed?: boolean;
}) {
  const { sign, step } = useSiweSign();

  const handleSignIn = async () => {
    posthog.capture('sign_in_started', { method: 'ethereum' });
    const result = await sign();
    if (!result) return;

    const res = await signIn('credentials', {
      message: result.message,
      signature: result.signature,
      client,
      redirect: false,
    });

    if (res?.error) {
      posthog.capture('sign_in_failed', { method: 'ethereum' });
      toast.error('Sign in failed. Please try again.');
    } else {
      posthog.capture('sign_in_completed', { method: 'ethereum' });
    }
  };

  const label =
    step === 'connecting'
      ? 'Connecting wallet…'
      : step === 'signing'
        ? 'Sign in your wallet…'
        : 'Continue with Ethereum';

  return (
    <SignInMethodButton
      data-testid="siwe-sign-in-btn"
      onClick={handleSignIn}
      disabled={step !== 'idle'}
      busy={step !== 'idle'}
      icon={<EthereumIcon />}
      isLastUsed={isLastUsed}
    >
      {label}
    </SignInMethodButton>
  );
}
