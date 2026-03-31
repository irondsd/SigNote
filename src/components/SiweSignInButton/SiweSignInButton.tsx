'use client';

import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import '@rainbow-me/rainbowkit/styles.css';
import { useSiweSign } from '@/hooks/useSiweSign';
import { EthereumIcon } from '../icons/SignInIcons';

export function SiweSignInButton() {
  const { sign, step } = useSiweSign();

  const handleSignIn = async () => {
    const result = await sign();
    if (!result) return;

    const res = await signIn('credentials', {
      message: result.message,
      signature: result.signature,
      redirect: false,
    });

    if (res?.error) {
      toast.error('Sign in failed. Please try again.');
    }
  };

  const label =
    step === 'connecting'
      ? 'Connecting wallet…'
      : step === 'signing'
        ? 'Sign in your wallet…'
        : 'Sign in with Ethereum';

  return (
    <Button
      data-testid="siwe-sign-in-btn"
      onClick={handleSignIn}
      disabled={step !== 'idle'}
      className="w-full bg-black text-white hover:bg-zinc-800 border-0 rounded-lg h-11 font-medium flex items-center gap-3 px-4"
    >
      <EthereumIcon />
      {label}
    </Button>
  );
}
