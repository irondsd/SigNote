'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import s from './NoteCardBase.module.scss';

function colorClass(color: string | null | undefined) {
  if (!color) return undefined;
  const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  return s[key as keyof typeof s];
}

type NoteCardBaseProps = {
  title?: string;
  updatedAt: string | Date;
  color?: string | null;
  onClick: () => void;
  showArchivedBadge?: boolean;
  archived?: boolean;
  content?: React.ReactNode;
  'data-testid'?: string;
};

export function NoteCardBase({
  title,
  updatedAt,
  color,
  onClick,
  showArchivedBadge = false,
  archived = false,
  content,
  'data-testid': testId,
}: NoteCardBaseProps) {
  const date = new Date(updatedAt).toLocaleDateString();
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
      className={cn(s.card, colorClass(color))}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
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
      <span className={s.date}>{date}</span>
    </div>
  );
}
