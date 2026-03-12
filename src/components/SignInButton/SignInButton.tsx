'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { signIn } from 'next-auth/react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@rainbow-me/rainbowkit/styles.css';

type SignInButtonProps = {
  size?: 'default' | 'large';
};

export function SignInButton({ size = 'default' }: SignInButtonProps) {
  const { address, isConnected, chain } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signMessageAsync } = useSignMessage();

  const handleSignIn = async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }

    try {
      const nonceRes = await fetch('/api/auth/nonce');
      const { nonce } = await nonceRes.json();

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in with Ethereum to SigNote.',
        uri: window.location.origin,
        version: '1',
        chainId: chain?.id ?? 1,
        nonce,
      });

      const messageStr = message.prepareMessage();
      const signature = await signMessageAsync({ message: messageStr });

      await signIn('credentials', {
        message: messageStr,
        signature,
        redirect: false,
      });
    } catch (err) {
      console.error('SIWE error:', err);
    }
  };

  if (size === 'large') {
    return (
      <Button
        size="lg"
        className="w-full rounded-[14px] text-base font-bold h-auto py-[14px] px-8 shadow-[0_4px_20px_color-mix(in_oklch,var(--primary)_35%,transparent)] hover:-translate-y-px"
        onClick={handleSignIn}
      >
        <Wallet size={24} />
        Sign in with Ethereum
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      className="w-full bg-muted hover:bg-primary hover:text-primary-foreground hover:border-primary"
      onClick={handleSignIn}
    >
      <Wallet size={16} />
      Sign in with Ethereum
    </Button>
  );
}
