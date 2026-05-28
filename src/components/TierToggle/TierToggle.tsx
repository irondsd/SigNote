'use client';

import { FileText, KeyRound, Shield } from 'lucide-react';
import { cn } from '@/utils/cn';
import s from './TierToggle.module.scss';

export type TierSet = Set<'notes' | 'secrets' | 'seals'>;

const TIERS = [
  { key: 'notes' as const, label: 'Notes', Icon: FileText },
  { key: 'secrets' as const, label: 'Secrets', Icon: KeyRound },
  { key: 'seals' as const, label: 'Seals', Icon: Shield },
] as const;

type TierToggleProps = {
  active: TierSet;
  onChange: (next: TierSet) => void;
};

export function TierToggle({ active, onChange }: TierToggleProps) {
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
    <div className={s.toggle} role="group" aria-label="Filter by tier">
      {TIERS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={cn(s.chip, active.has(key) && s.active)}
          onClick={() => toggle(key)}
          aria-pressed={active.has(key)}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
