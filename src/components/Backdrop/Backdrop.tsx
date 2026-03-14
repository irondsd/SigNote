import { ReactNode, useEffect } from 'react';
import { cn } from '@/utils/cn';
import styles from './Backdrop.module.scss';

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

  return (
    <div className={cn(styles.backdrop, className)} onClick={disableClose ? undefined : onClose}>
      {children}
    </div>
  );
}
