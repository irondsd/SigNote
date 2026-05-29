'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Archive, Flame, Pin } from 'lucide-react';
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
  pinned?: boolean;
  hasExpiry?: boolean;
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
  pinned = false,
  hasExpiry = false,
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
      {(pinned || hasExpiry) && (
        <div className={s.indicators}>
          {pinned && (
            <span className={s.pinIndicator} data-testid="pin-flag" aria-label="Pinned">
              <Pin size={12} />
            </span>
          )}
          {hasExpiry && (
            <span className={s.expiryIndicator} data-testid="expiry-flag" aria-label="Self-destructs">
              <Flame size={12} />
            </span>
          )}
        </div>
      )}
      {title && <h3 className={s.title}>{title}</h3>}
      {content != null && (
        <div ref={contentRef} className={cn(s.content, isOverflowing && s.contentFaded)}>
          {content}
        </div>
      )}
      <div className={s.footer}>
        {showArchivedBadge && archived && (
          <span data-testid="archived-badge" className={s.archivedBadge}>
            <Archive size={11} strokeWidth={1.9} />
            Archived
          </span>
        )}
        <RelativeDate updatedAt={updatedAt} className={s.date} />
      </div>
    </div>
  );
}
