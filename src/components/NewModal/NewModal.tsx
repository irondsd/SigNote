'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import styles from './NewModal.module.scss';

type NewModalProps = {
  heading: string;
  onClose: () => void;
  onBackdropClose?: () => void;
  footer: ReactNode;
  children: ReactNode;
};

export function NewModal({ heading, onClose, onBackdropClose, footer, children }: NewModalProps) {
  return (
    <Backdrop onClose={onBackdropClose ?? onClose}>
      <Modal>
        <div className={styles.header}>
          <h2 className={styles.heading}>{heading}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.footer}>{footer}</div>
      </Modal>
    </Backdrop>
  );
}
