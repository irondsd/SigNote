import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import s from './Modal.module.scss';

type ModalProps = {
  children: ReactNode;
  className?: string;
};

export function Modal({ children, className }: ModalProps) {
  return (
    <div data-testid="note-modal" className={cn(s.modal, className)} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
