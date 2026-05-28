'use client';

import { cn } from '@/utils/cn';
import s from './TierToggle.module.scss';
import { InlineSvg } from '@irondsd/inline-svg';

export type TierSet = Set<'notes' | 'secrets' | 'seals'>;

const TIERS = [
  { key: 'notes' as const, label: 'Notes', icon: 'notes.svg' },
  { key: 'secrets' as const, label: 'Secrets', icon: 'secrets.svg' },
  { key: 'seals' as const, label: 'Seals', icon: 'seals.svg' },
] as const;

type TierToggleProps = {
  active: TierSet;
  onChange: (next: TierSet) => void;
  counts?: Partial<Record<'notes' | 'secrets' | 'seals', number>>;
  showCounts?: boolean;
};

export function TierToggle({ active, onChange, counts, showCounts }: TierToggleProps) {
  const toggle = (key: 'notes' | 'secrets' | 'seals') => {
    const next = new Set(active);
    if (next.has(key)) {
      if (next.size > 1) next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  return (
    <div className={s.segmented} role="group" aria-label="Filter by tier">
      {TIERS.map(({ key, label, icon }) => {
        const isActive = active.has(key);
        const count = counts?.[key];
        return (
          <button
            key={key}
            type="button"
            className={cn(s.seg, isActive && s.active)}
            onClick={() => toggle(key)}
            aria-pressed={isActive}
          >
            <InlineSvg src={`/icons/${icon}`} className={'w-4 h-4'} />
            {label}
            {showCounts && count !== undefined && (
              <span className={cn(s.count, isActive && s.countActive)}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
