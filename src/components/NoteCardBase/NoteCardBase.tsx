'use client';

import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { NOTE_COLORS, type NoteColor, type NotePattern } from '@/config/noteColors';
import { getPatternStyle } from '@/config/notePatterns';
import { useIsDark } from '@/hooks/useIsDark';
import { RelativeDate } from '@/components/RelativeDate/RelativeDate';
import s from './NoteCardBase.module.scss';

function cardStyle(
  color: string | null | undefined,
  pattern: string | null | undefined,
  isDark: boolean,
): CSSProperties | undefined {
  const style: Record<string, string | undefined> = {};
  let hasSomething = false;

  if (color && NOTE_COLORS.includes(color as NoteColor)) {
    style['--note-card-bg'] = `var(--note-${color})`;
    style['border'] = 'none';
    hasSomething = true;
  }

  const patStyle = getPatternStyle(
    (color as NoteColor) ?? null,
    (pattern as NotePattern) ?? null,
    isDark,
  );
  if (patStyle) {
    Object.assign(style, patStyle);
    hasSomething = true;
  }

  return hasSomething ? (style as unknown as CSSProperties) : undefined;
}

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
  const isDark = useIsDark();

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollHeight > el.clientHeight);
  }, [content]);

  return (
    <div
      data-testid={testId}
      className={cn(s.card)}
      style={cardStyle(color, pattern, isDark)}
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
