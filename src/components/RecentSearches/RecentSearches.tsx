'use client';

import { Clock, CornerDownLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { InlineSvg } from '@irondsd/inline-svg';
import s from './RecentSearches.module.scss';

const TIERS = [
  { key: 'notes', label: 'Notes', href: '/', icon: 'notes.svg' },
  { key: 'secrets', label: 'Secrets', href: '/secrets', icon: 'secrets.svg' },
  { key: 'seals', label: 'Seals', href: '/seals', icon: 'seals.svg' },
] as const;

type Props = {
  recents: string[];
  onPick: (q: string) => void;
  /** Fired when a tier card is clicked — used by the overlay to close itself
   *  (navigation to the currently-active tier is a no-op otherwise). */
  onNavigate?: () => void;
};

export function RecentSearches({ recents, onPick, onNavigate }: Props) {
  return (
    <div className={s.root}>
      {recents.length > 0 && (
        <section className={s.section}>
          <header className={s.sectionHead}>
            <Clock size={14} strokeWidth={1.9} />
            <span className={s.sectionLabel}>Recent searches</span>
          </header>
          <div className={s.pills}>
            {recents.map((r) => (
              <button key={r} type="button" className={s.pill} onClick={() => onPick(r)}>
                <Search size={13} strokeWidth={1.9} className={s.pillIcon} />
                {r}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className={s.section}>
        <header className={s.sectionHead}>
          <CornerDownLeft size={14} strokeWidth={1.9} />
          <span className={s.sectionLabel}>Browse a tier</span>
        </header>
        <div className={s.tierGrid}>
          {TIERS.map(({ key, label, href, icon }) => (
            <Link key={key} href={href} className={s.tierCard} onClick={onNavigate}>
              <span className={s.tierIcon}>
                <InlineSvg src={`/icons/${icon}`} className="w-[19px] h-[19px]" />
              </span>
              <span className={s.tierLabel}>{label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
