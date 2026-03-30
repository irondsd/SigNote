'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { signIn } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { useAccount, useAccountEffect, useDisconnect, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import '@rainbow-me/rainbowkit/styles.css';
import { api } from '@/lib/api';
import { Address, UserRejectedRequestError } from 'viem';

type Step = 'idle' | 'connecting' | 'signing';

export function SiweSignInButton() {
  const { address, isConnected, chain } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [step, setStep] = useState<Step>('idle');
  const pendingSign = useRef(false);
  const modalWasOpen = useRef(false);

  useEffect(() => {
    if (connectModalOpen) {
      modalWasOpen.current = true;
      return;
    }
    if (modalWasOpen.current && !isConnected) {
      modalWasOpen.current = false;
      pendingSign.current = false;
      queueMicrotask(() => {
        setStep((currentStep) => (currentStep === 'connecting' ? 'idle' : currentStep));
      });
    }
  }, [connectModalOpen, isConnected]);

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
      const { nonce } = await api.get('/api/auth/nonce').json<{ nonce: string }>();

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
      if (err instanceof UserRejectedRequestError) {
        toast.error('Signature rejected. Please try again.');
        setStep('idle');
        return;
      }
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

  return (
    <Button
      onClick={handleSignIn}
      disabled={busy}
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
