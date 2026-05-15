'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { RelativeDate } from '@/components/RelativeDate/RelativeDate';
import s from './NoteCardBase.module.scss';

type NoteCardBaseProps = {
  title?: string;
  updatedAt: string | Date;
  color?: string | null;
  pattern?: string | null;
  onClick: (rect: DOMRect) => void;
  showArchivedBadge?: boolean;
  archived?: boolean;
  content?: React.ReactNode;
  'data-testid'?: string;
};

export function NoteCardBase({
  title,
  updatedAt,
  color,
  pattern,
  onClick,
  showArchivedBadge = false,
  archived = false,
  content,
  'data-testid': testId,
}: NoteCardBaseProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollHeight > el.clientHeight);
  }, [content]);

  return (
    <div
      data-testid={testId}
      className={cn(s.card)}
      data-color={color || undefined}
      data-pattern={pattern || undefined}
      role="button"
      tabIndex={0}
      onClick={(e) => onClick((e.currentTarget as HTMLElement).getBoundingClientRect())}
      onKeyDown={(e) =>
        (e.key === 'Enter' || e.key === ' ') && onClick((e.currentTarget as HTMLElement).getBoundingClientRect())
      }
    >
      {title && <h3 className={s.title}>{title}</h3>}
      {content != null && (
        <div ref={contentRef} className={cn(s.content, isOverflowing && s.contentFaded)}>
          {content}
        </div>
      )}
      {showArchivedBadge && archived && (
        <span data-testid="archived-badge" className={s.archivedBadge}>
          Archived
        </span>
      )}
      <RelativeDate updatedAt={updatedAt} className={s.date} />
    </div>
  );
}
