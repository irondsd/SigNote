'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { useDesktopApp } from '@/hooks/useDesktopApp';
import { SignInOptions, type SignInView } from './SignInOptions';
import { cn } from '@/utils/cn';
import s from './SignInModal.module.scss';

type SignInModalProps = {
  onClose: () => void;
};

export function SignInModal({ onClose }: SignInModalProps) {
  const isDesktop = useDesktopApp();
  const { status } = useSession();
  const [view, setView] = useState<SignInView>('list');

  useEffect(() => {
    if (isDesktop && status === 'authenticated') onClose();
  }, [isDesktop, onClose, status]);

  const isStep = view !== 'list';

  return (
    <Backdrop onClose={onClose}>
      <Modal className={s.modal}>
        <div className={cn(s.header, isStep && s.headerRuled)}>
          <div className={s.headingGroup}>
            <h2 className={s.heading}>Sign in to SigNote</h2>
            {!isStep && <p className={s.subheading}>Pick how you want to continue.</p>}
          </div>
          <Button variant="ghost" size="icon-md" className={s.close} onClick={onClose} title="Close" aria-label="Close">
            <X size={15} />
          </Button>
        </div>

        <div className={cn(s.body, isStep && s.bodyStep)}>
          <SignInOptions isDesktop={isDesktop} onViewChange={setView} />

          {view === 'list' && (
            <p className={s.footer}>
              End-to-end encrypted · <Link href="/docs/privacy">Privacy Policy</Link>
            </p>
          )}
        </div>
      </Modal>
    </Backdrop>
  );
}
