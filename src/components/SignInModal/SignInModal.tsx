'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { useDesktopApp } from '@/hooks/useDesktopApp';
import { SignInOptions } from './SignInOptions';
import s from './SignInModal.module.scss';

type SignInModalProps = {
  onClose: () => void;
};

export function SignInModal({ onClose }: SignInModalProps) {
  const isDesktop = useDesktopApp();
  const { status } = useSession();

  useEffect(() => {
    if (isDesktop && status === 'authenticated') onClose();
  }, [isDesktop, onClose, status]);

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
          <SignInOptions isDesktop={isDesktop} />
        </div>
      </Modal>
    </Backdrop>
  );
}
