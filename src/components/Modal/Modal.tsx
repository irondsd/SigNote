import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from 'react';
import { cn } from '@/utils/cn';
import s from './Modal.module.scss';

type ModalProps = {
  children: ReactNode;
  className?: string;
  cardRect?: DOMRect;
  style?: CSSProperties;
};

export function Modal({ children, className, cardRect, style }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!cardRect || !modalRef.current || window.innerWidth <= 767) return;
    const el = modalRef.current;
    const modalRect = el.getBoundingClientRect();

    const dx = cardRect.left + cardRect.width / 2 - (modalRect.left + modalRect.width / 2);
    const dy = cardRect.top + cardRect.height / 2 - (modalRect.top + modalRect.height / 2);
    const sx = cardRect.width / modalRect.width;
    const sy = cardRect.height / modalRect.height;

    // Suppress CSS animation and snap to card position before first paint
    el.style.animation = 'none';
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0.4';

    // Double rAF: first rAF lets the browser paint the initial (card-position) frame,
    // second rAF then starts the CSS transition to the natural position.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
        el.style.transform = '';
        el.style.opacity = '';
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      // Reset so React StrictMode's second run starts from a clean state
      el.style.animation = '';
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only runs on mount

  return (
    <div
      ref={modalRef}
      data-testid="note-modal"
      className={cn(s.modal, className)}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
