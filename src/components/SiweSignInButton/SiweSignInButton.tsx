'use client';

import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import '@rainbow-me/rainbowkit/styles.css';
import { useSiweSign } from '@/hooks/useSiweSign';

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
      onClick={handleSignIn}
      disabled={step !== 'idle'}
      className="w-full bg-black text-white hover:bg-zinc-800 border-0 rounded-lg h-11 font-medium flex items-center gap-3 px-4"
    >
      {/* Ethereum diamond logo */}
      <svg fill="currentColor" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width={18} height={18} aria-hidden="true">
        <path d="M15.927 23.959l-9.823-5.797 9.817 13.839 9.828-13.839-9.828 5.797zM16.073 0l-9.819 16.297 9.819 5.807 9.823-5.801z"/>
      </svg>
      {label}
    </Button>
  );
}
