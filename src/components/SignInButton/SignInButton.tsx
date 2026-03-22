'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { signIn } from 'next-auth/react';
import { useRef, useState } from 'react';
import { useAccount, useAccountEffect, useDisconnect, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import '@rainbow-me/rainbowkit/styles.css';
import { cn } from '@/utils/cn';
import { EthereumIcon } from '../EthereumIcon/EthereumIcon';
import { Address } from 'viem';

type SignInButtonProps = {
  className?: string;
  size?: 'default' | 'large';
};

type Step = 'idle' | 'connecting' | 'signing';

export function SignInButton({ className, size = 'default' }: SignInButtonProps) {
  const { address, isConnected, chain } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [step, setStep] = useState<Step>('idle');
  const pendingSign = useRef(false);

  useAccountEffect({
    onConnect({ address: connectedAddress }) {
      if (connectedAddress && pendingSign.current) {
        pendingSign.current = false;
        void doSign(connectedAddress);
      }
    },
  });

  const doSign = async (address: Address) => {
    setStep('signing');
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

      const result = await signIn('credentials', {
        message: messageStr,
        signature,
        redirect: false,
      });

      if (result?.error) {
        toast.error('Sign in failed. Please try again.');
      }
      setStep('idle');
    } catch (err) {
      console.error('SIWE error:', err);
      // Stale WalletConnect session or rejected — disconnect and let user reconnect
      disconnect();
      pendingSign.current = true;
      setStep('connecting');
      openConnectModal?.();
    }
  };

  const handleSignIn = () => {
    if (!isConnected || !address) {
      pendingSign.current = true;
      setStep('connecting');
      openConnectModal?.();
      return;
    }

    doSign(address);
  };

  const label =
    step === 'connecting'
      ? 'Connecting wallet…'
      : step === 'signing'
        ? 'Sign in your wallet…'
        : 'Sign in with Ethereum';

  const busy = step !== 'idle';

  if (size === 'large') {
    return (
      <Button
        data-testid="sign-in-button"
        size="lg"
        disabled={busy}
        className={cn(
          "w-full rounded-[14px] text-base font-bold h-13 py-2 px-8 shadow-[0_4px_20px_color-mix(in_oklch,var(--primary)_35%,transparent)] hover:-translate-y-px [&_svg:not([class*='size-'])]:size-5",
          className,
        )}
        onClick={handleSignIn}
      >
        <EthereumIcon />
        {label}
      </Button>
    );
  }

  return (
    <Button
      data-testid="sign-in-button"
      variant="outline"
      disabled={busy}
      className={cn('w-full bg-muted hover:bg-primary hover:text-primary-foreground hover:border-primary', className)}
      onClick={handleSignIn}
    >
      <Wallet size={16} />
      {label}
    </Button>
  );
}
