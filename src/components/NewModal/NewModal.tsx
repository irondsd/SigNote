'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import s from './NewModal.module.scss';

type NewModalProps = {
  heading: ReactNode;
  onClose: () => void;
  onBackdropClose?: () => void;
  footer: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
};

export function NewModal({ heading, onClose, onBackdropClose, footer, toolbar, children }: NewModalProps) {
  return (
    <Backdrop onClose={onBackdropClose ?? onClose}>
      <Modal>
        <div className={s.header}>
          {heading}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </Button>
        </div>
        <div className={s.body}>{children}</div>
        {toolbar}
        <div className={s.footer}>{footer}</div>
      </Modal>
    </Backdrop>
  );
}
