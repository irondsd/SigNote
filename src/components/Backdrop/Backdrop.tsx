import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import s from './Backdrop.module.scss';

type BackdropProps = {
  onClose: () => void;
  className?: string;
  children: ReactNode;
  disableClose?: boolean;
};

export function Backdrop({ onClose, className, children, disableClose }: BackdropProps) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return createPortal(
    <div className={cn(s.backdrop, className)} onClick={disableClose ? undefined : onClose} data-backdrop="true">
      {children}
    </div>,
    document.body,
  );
}
