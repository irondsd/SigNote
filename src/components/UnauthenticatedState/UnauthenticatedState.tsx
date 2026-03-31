'use client';

import { KeyRound } from 'lucide-react';
import { SignInButton } from '@/components/SignInButton/SignInButton';
import s from './UnauthenticatedState.module.scss';

export function UnauthenticatedState() {
  return (
    <div className={s.container}>
      <div className={s.icon}>
        <KeyRound size={56} strokeWidth={1} />
      </div>
      <h2 className={s.heading}>Welcome to SigNote</h2>
      <p className={s.sub}>
        Sign in to access your notes securely.
      </p>
      <SignInButton size="large" className={'max-w-100'} />
    </div>
  );
}
