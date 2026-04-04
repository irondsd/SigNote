import { ReactNode, useEffect, useState } from 'react';
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
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      setKeyboardOpen(window.innerHeight - vv.height > 150);
    };

    // Initialize keyboardOpen on mount in case the keyboard is already visible
    handleResize();
    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  return createPortal(
    <div
      className={cn(s.backdrop, keyboardOpen && s.keyboardOpen, className)}
      onClick={disableClose ? undefined : onClose}
      data-backdrop="true"
    >
      {children}
    </div>,
    document.body,
  );
}
