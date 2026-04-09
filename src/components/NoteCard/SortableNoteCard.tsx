'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from './NoteCard';

type SortableNoteCardProps = {
  note: NoteDocument;
  onClick: (rect: DOMRect) => void;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SortableNoteCard({ note, onClick, showArchivedBadge, isDragDisabled = false }: SortableNoteCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: note._id.toString(),
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
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          clearTimeout(touchTimerRef.current);
        }
      }
      if (shouldPreventScrollRef.current) {
        e.preventDefault();
      }
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

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div
      ref={combinedRef}
      style={style}
      {...(!isDragDisabled ? attributes : {})}
      {...(!isDragDisabled ? listeners : {})}
    >
      <NoteCard note={note} onClick={onClick} showArchivedBadge={showArchivedBadge} />
    </div>
  );
}
