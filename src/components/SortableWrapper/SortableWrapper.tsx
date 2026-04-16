'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type SortableWrapperProps = {
  id: string;
  isDragDisabled?: boolean;
  children: ReactNode;
};

export function SortableWrapper({ id, isDragDisabled = false, children }: SortableWrapperProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id,
    disabled: isDragDisabled,
  });

  const elementRef = useRef<HTMLDivElement>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const shouldPreventScrollRef = useRef(false);

  useEffect(() => {
    const el = elementRef.current;
    if (!el || isDragDisabled) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      shouldPreventScrollRef.current = false;
      touchTimerRef.current = setTimeout(() => {
        shouldPreventScrollRef.current = true;
      }, 200);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!shouldPreventScrollRef.current && startPosRef.current) {
        const touch = e.touches[0];
        const dx = touch.clientX - startPosRef.current.x;
        const dy = touch.clientY - startPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) clearTimeout(touchTimerRef.current);
      }
      if (shouldPreventScrollRef.current) e.preventDefault();
    };

    const onTouchEnd = () => {
      clearTimeout(touchTimerRef.current);
      shouldPreventScrollRef.current = false;
      startPosRef.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      clearTimeout(touchTimerRef.current);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isDragDisabled]);

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      elementRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  return (
    <div
      ref={combinedRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : undefined }}
      {...(!isDragDisabled ? attributes : {})}
      {...(!isDragDisabled ? listeners : {})}
    >
      {children}
    </div>
  );
}
