'use client';

import type { ReactNode } from 'react';
import s from './NoteActionsMenu.module.scss';

export type MenuItemTone = 'default' | 'accent' | 'danger';

type MenuItemProps = {
  icon: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  tone?: MenuItemTone;
  disabled?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
  'data-testid'?: string;
};

export function MenuItem({
  icon,
  label,
  hint,
  tone = 'default',
  disabled = false,
  trailing,
  onClick,
  ...rest
}: MenuItemProps) {
  return (
    <button
      type="button"
      className={s.item}
      data-tone={tone === 'default' ? undefined : tone}
      data-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      <span className={s.itemIcon}>{icon}</span>
      <span className={s.itemLabel}>
        <span>{label}</span>
        {hint && <span className={s.itemHint}>{hint}</span>}
      </span>
      {trailing}
    </button>
  );
}
