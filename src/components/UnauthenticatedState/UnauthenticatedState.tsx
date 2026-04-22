'use client';

import Image from 'next/image';
import { SignInButton } from '@/components/SignInButton/SignInButton';
import s from './UnauthenticatedState.module.scss';

export function UnauthenticatedState() {
  return (
    <div className={s.root}>
      <div className={s.bgGrid} aria-hidden />
      <div className={s.bgGlow} aria-hidden />

      <div className={s.card}>
        <div className={s.logo}>
          <Image className={s.logoIcon} src="/images/logo.svg" alt="SigNote" width={19} height={32} />
          <span className={s.logoText}>SigNote</span>
        </div>

        <h1 className={s.heading}>Welcome back</h1>
        <p className={s.sub}>
          Sign in to access your notes,
          <br />
          secrets, and seals.
        </p>
        <SignInButton size="large" />
        <div className={s.footer}>End-to-end encrypted</div>
      </div>
    </div>
  );
}
