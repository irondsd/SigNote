'use client';

import { X } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { SiweSignInButton } from '@/components/SiweSignInButton/SiweSignInButton';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import s from './SignInModal.module.scss';

type SignInModalProps = {
  onClose: () => void;
};

export function SignInModal({ onClose }: SignInModalProps) {
  return (
    <Backdrop onClose={onClose}>
      <Modal className={s.modal}>
        <div className={s.header}>
          <h2 className={s.heading}>Sign in to SigNote</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close" aria-label="Close">
            <X size={18} />
          </Button>
        </div>

        <div className={s.body}>
          <Button
            onClick={() => signIn('google')}
            data-testid="google-sign-in-btn"
            className="w-full bg-white text-zinc-800 hover:bg-zinc-100 border border-zinc-200 rounded-lg h-11 font-medium flex items-center gap-3 px-4"
          >
            <GoogleIcon />
            Sign in with Google
          </Button>

          <div className={s.divider}>
            <span>or</span>
          </div>

          <SiweSignInButton />
        </div>
      </Modal>
    </Backdrop>
  );
}
