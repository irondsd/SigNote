'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Archive, Flame, LoaderCircle, Pin } from 'lucide-react';
import { cn } from '@/utils/cn';
import { RelativeDate } from '@/components/RelativeDate/RelativeDate';
import { Tag, type TagLike } from '@/components/Tag/Tag';
import s from './NoteCardBase.module.scss';

const MAX_CARD_TAGS = 3;

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
  /** Optimistic card whose create hasn't reached the server yet — it can't be opened until it does. */
  saving?: boolean;
  tags?: TagLike[];
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
  saving = false,
  tags,
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
      {(pinned || hasExpiry || saving) && (
        <div className={s.indicators}>
          {saving && (
            <span className={s.savingIndicator} data-testid="saving-flag" aria-label="Saving" title="Saving…">
              <LoaderCircle size={12} />
            </span>
          )}
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
        {tags && tags.length > 0 && (
          <div className={s.tags} data-testid="card-tags">
            {tags.slice(0, MAX_CARD_TAGS).map((t) => (
              <Tag key={t.name} tag={t} size="xs" variant="soft" />
            ))}
            {tags.length > MAX_CARD_TAGS && <span className={s.tagsMore}>+{tags.length - MAX_CARD_TAGS}</span>}
          </div>
        )}
        <RelativeDate updatedAt={updatedAt} className={s.date} />
      </div>
    </div>
  );
}
