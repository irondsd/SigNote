'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { signIn } from 'next-auth/react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { Wallet } from 'lucide-react';
import '@rainbow-me/rainbowkit/styles.css';
import s from './SignInButton.module.scss';

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
      <button className={s.siweBtnLarge} onClick={handleSignIn}>
        <Wallet size={24} />
        Sign in with Ethereum
      </button>
    );
  }

  return (
    <button className={s.siweBtn} onClick={handleSignIn}>
      <Wallet size={16} />
      Sign in with Ethereum
    </button>
  );
}
