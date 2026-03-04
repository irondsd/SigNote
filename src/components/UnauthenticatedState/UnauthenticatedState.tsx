'use client';

import { Wallet } from 'lucide-react';
import { SignInButton } from '@/components/SignInButton/SignInButton';
import styles from './UnauthenticatedState.module.scss';

export function UnauthenticatedState() {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <Wallet size={56} strokeWidth={1} />
      </div>
      <h2 className={styles.heading}>Welcome to SigNote</h2>
      <p className={styles.sub}>
        Sign in with your Ethereum wallet<br />to access your notes securely.
      </p>
      <SignInButton size="large" />
    </div>
  );
}
