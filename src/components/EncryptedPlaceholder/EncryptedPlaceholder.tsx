'use client';

import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import styles from './EncryptedPlaceholder.module.scss';

type EncryptedPlaceholderProps = {
  /** Number of placeholder bar rows to render */
  rows?: number;
};

export function EncryptedPlaceholder({ rows = 3 }: EncryptedPlaceholderProps) {
  // Widths vary per row for a natural look
  const rowWidths = ['85%', '70%', '90%', '60%', '75%'];

  return (
    <div className={styles.wrapper}>
      <div className={styles.bars}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={styles.bar}
            style={{ width: rowWidths[i % rowWidths.length] }}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={styles.lockIcon} aria-label="Content is encrypted">
            <Lock size={14} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Encrypted</TooltipContent>
      </Tooltip>
    </div>
  );
}
