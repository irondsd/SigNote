'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import styles from './NoteCardBase.module.scss';

function colorClass(color: string | null | undefined) {
  if (!color) return undefined;
  const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  return styles[key as keyof typeof styles];
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
      className={cn(styles.card, colorClass(color))}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      {title && <h3 className={styles.title}>{title}</h3>}
      {content != null && (
        <div ref={contentRef} className={cn(styles.content, isOverflowing && styles.contentFaded)}>
          {content}
        </div>
      )}
      {showArchivedBadge && archived && (
        <span data-testid="archived-badge" className={styles.archivedBadge}>
          Archived
        </span>
      )}
      <span className={styles.date}>{date}</span>
    </div>
  );
}
