'use client';

import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import s from './EncryptedPlaceholder.module.scss';

type EncryptedPlaceholderProps = {
  /** Number of placeholder bar rows to render */
  rows?: number;
};

export function EncryptedPlaceholder({ rows = 3 }: EncryptedPlaceholderProps) {
  // Widths vary per row for a natural look
  const rowWidths = ['85%', '70%', '90%', '60%', '75%'];

  return (
    <div data-testid="encrypted-placeholder" className={s.wrapper}>
      <div className={s.bars}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={s.bar} style={{ width: rowWidths[i % rowWidths.length] }} />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={s.lockIcon} aria-label="Content is encrypted">
            <Lock size={14} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Encrypted</TooltipContent>
      </Tooltip>
    </div>
  );
}
