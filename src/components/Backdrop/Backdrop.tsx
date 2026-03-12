import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from './Backdrop.module.scss';

type BackdropProps = {
  onClose: () => void;
  className?: string;
  children: ReactNode;
};

export function Backdrop({ onClose, className, children }: BackdropProps) {
  return (
    <div className={cn(styles.backdrop, className)} onClick={onClose}>
      {children}
    </div>
  );
}
