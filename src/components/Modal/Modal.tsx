import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from './Modal.module.scss';

type ModalProps = {
  children: ReactNode;
  className?: string;
};

export function Modal({ children, className }: ModalProps) {
  return (
    <div className={cn(styles.modal, className)} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
