'use client';

import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { TagColor } from '@/config/noteStyles';
import s from './Tag.module.scss';

export type TagVariant = 'soft' | 'outline' | 'solid';
export type TagSize = 'xs' | 'sm' | 'md';

export type TagLike = { name: string; color?: TagColor | string | null };

type TagProps = {
  tag: TagLike;
  variant?: TagVariant;
  size?: TagSize;
  dot?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
  'data-testid'?: string;
};

export function Tag({
  tag,
  variant = 'soft',
  size = 'sm',
  dot = false,
  selected = false,
  onClick,
  onRemove,
  className,
  'data-testid': testId,
}: TagProps) {
  const interactive = !!onClick;
  return (
    <span
      data-testid={testId}
      data-color={tag.color || undefined}
      className={cn(s.tag, s[size], s[variant], selected && s.selected, interactive && s.interactive, className)}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {dot && <span className={s.dot} />}
      <span className={s.label}>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          className={s.remove}
          aria-label={`Remove ${tag.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={size === 'md' ? 13 : 11} strokeWidth={2.4} />
        </button>
      )}
    </span>
  );
}
