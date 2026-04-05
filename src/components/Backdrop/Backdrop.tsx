import { CSSProperties, ReactNode, useEffect, useState } from 'react';
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
  const [vpStyle, setVpStyle] = useState<CSSProperties>({});

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const isOpen = window.innerHeight - vv.height > 150;
      setKeyboardOpen(isOpen);
      // On mobile, pin the backdrop to the visual viewport so the modal
      // sits above the keyboard rather than underneath it.
      if (isOpen && window.innerWidth <= 767) {
        setVpStyle({ top: `${vv.offsetTop}px`, height: `${vv.height}px`, bottom: 'auto' });
      } else {
        setVpStyle({});
      }
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return createPortal(
    <div
      className={cn(s.backdrop, keyboardOpen && s.keyboardOpen, className)}
      style={vpStyle}
      onClick={disableClose ? undefined : onClose}
      data-backdrop="true"
    >
      {children}
    </div>,
    document.body,
  );
}
