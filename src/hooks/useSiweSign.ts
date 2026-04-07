'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useAccountEffect, useDisconnect, useSignMessage } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { SiweMessage } from 'siwe';
import { UserRejectedRequestError } from 'viem';
import { api } from '@/lib/api';

export type SiweStep = 'idle' | 'connecting' | 'signing';

export type SiweSignResult = { message: string; signature: string; address: string } | null;

/**
 * Shared hook for the SIWE signing flow.
 * Handles wallet connection → message signing → returns { message, signature, address }.
 * Does NOT submit to any endpoint — callers decide what to do with the result.
 */
export function useSiweSign() {
  const { address, isConnected, chain } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [step, setStep] = useState<SiweStep>('idle');
  const pendingSign = useRef(false);
  const modalWasOpen = useRef(false);
  const onSignedRef = useRef<((result: SiweSignResult) => void) | null>(null);

  useEffect(() => {
    if (connectModalOpen) {
      modalWasOpen.current = true;
      return;
    }
    if (modalWasOpen.current && !isConnected) {
      modalWasOpen.current = false;
      pendingSign.current = false;
      queueMicrotask(() => {
        setStep((current) => (current === 'connecting' ? 'idle' : current));
      });
      onSignedRef.current?.(null);
      onSignedRef.current = null;
    }
  }, [connectModalOpen, isConnected]);

  const doSign = async (addr: string): Promise<SiweSignResult> => {
    setStep('signing');
    try {
      const { nonce } = await api.get('/api/auth/nonce').json<{ nonce: string }>();

      const message = new SiweMessage({
        domain: window.location.host,
        address: addr,
        statement: 'Sign in with Ethereum to SigNote.',
        uri: window.location.origin,
        version: '1',
        chainId: chain?.id ?? 1,
        nonce,
      });

      const messageStr = message.prepareMessage();
      const signature = await signMessageAsync({ message: messageStr });
      setStep('idle');
      return { message: messageStr, signature, address: addr };
    } catch (err) {
      if (err instanceof UserRejectedRequestError) {
        // User rejected signature — reset to idle state
        pendingSign.current = false;
        setStep('idle');
        return null;
      }
      // Wallet disconnected mid-flow — re-open modal
      disconnect();
      pendingSign.current = true;
      setStep('connecting');
      openConnectModal?.();
      return null;
    }
  };

  useAccountEffect({
    onConnect({ address: connectedAddress }) {
      if (connectedAddress && pendingSign.current) {
        pendingSign.current = false;
        void doSign(connectedAddress).then((result) => {
          onSignedRef.current?.(result);
          onSignedRef.current = null;
        });
      }
    },
  });

  const sign = (): Promise<SiweSignResult> => {
    return new Promise((resolve) => {
      if (!isConnected || !address) {
        onSignedRef.current = resolve;
        pendingSign.current = true;
        setStep('connecting');
        openConnectModal?.();
        return;
      }
      void doSign(address).then(resolve);
    });
  };

  return { sign, step };
}
