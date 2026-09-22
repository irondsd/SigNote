import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import s from './Backdrop.module.scss';

type BackdropProps = {
  onClose: () => void;
  className?: string;
  children: ReactNode;
  disableClose?: boolean;
  animate?: boolean;
};

// Backdrops nest (a confirm dialog over a modal) and unmount parent-first, so
// each one restoring its own snapshot would leave the app inert. Instead, one
// stack owns the state: everything but the topmost backdrop is inert, and the
// original values come back once the last one closes.
const openBackdrops: HTMLElement[] = [];
const originalInert = new Map<HTMLElement, boolean>();

function syncInert() {
  for (const [element, wasInert] of originalInert) element.inert = wasInert;
  originalInert.clear();

  const top = openBackdrops.at(-1);
  if (!top) return;
  for (const child of document.body.children) {
    // Toasts (e.g. "Undo") must stay clickable over a modal.
    if (!(child instanceof HTMLElement) || child === top || child.hasAttribute('data-backdrop-exempt')) continue;
    originalInert.set(child, child.inert);
    child.inert = true;
  }
}

export function Backdrop({ onClose, className, children, disableClose, animate = true }: BackdropProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [vpStyle, setVpStyle] = useState<CSSProperties>({});

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (backdrop) openBackdrops.push(backdrop);
    syncInert();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      const index = backdrop ? openBackdrops.lastIndexOf(backdrop) : -1;
      if (index !== -1) openBackdrops.splice(index, 1);
      syncInert();
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const isOpen = window.innerHeight - vv.height > 150;
      setKeyboardOpen(isOpen);
      // Always pin mobile overlays to the visual viewport. Depending on the
      // browser/PWA display mode, the layout viewport may or may not resize
      // with the keyboard, so a keyboard-height threshold is not a reliable
      // geometry switch.
      setVpStyle((previous) => {
        if (window.innerWidth > 767) return Object.keys(previous).length === 0 ? previous : {};

        const top = `${vv.offsetTop}px`;
        const height = `${vv.height}px`;
        if (previous.top === top && previous.height === height && previous.bottom === 'auto') return previous;
        return { top, height, bottom: 'auto' };
      });
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
      ref={backdropRef}
      className={cn(s.backdrop, keyboardOpen && s.keyboardOpen, className)}
      style={animate ? vpStyle : { ...vpStyle, animation: 'none' }}
      onClick={disableClose ? undefined : onClose}
      data-backdrop="true"
    >
      {children}
    </div>,
    document.body,
  );
}
