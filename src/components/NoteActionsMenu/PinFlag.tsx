'use client';

import { Pin } from 'lucide-react';
import s from './PinFlag.module.scss';

export function PinFlag({ compact = false }: { compact?: boolean }) {
  return (
    <span className={s.flag} data-compact={compact} data-testid="pin-flag">
      <Pin size={compact ? 11 : 12} />
      {!compact && 'Pinned'}
    </span>
  );
}
