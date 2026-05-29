'use client';

import React, { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import s from './SearchResults.module.scss';
import { InlineSvg } from '@irondsd/inline-svg';

const TIER_ICONS = {
  notes: 'notes.svg',
  secrets: 'secrets.svg',
  seals: 'seals.svg',
} as const;

type StripShellProps = {
  tier: 'notes' | 'secrets' | 'seals';
  title: string;
  totalCount: number;
  showSeeAll?: boolean;
  seeAllHref?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  children: ReactNode;
};

export function StripShell({
  tier,
  title,
  totalCount,
  showSeeAll,
  seeAllHref,
  onLoadMore,
  hasMore,
  isLoadingMore,
  children,
}: StripShellProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const TierIcon = TIER_ICONS[tier];

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || !onLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) onLoadMore();
      },
      { threshold: 0.1, root: sentinelRef.current.parentElement },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  return (
    <section className={s.section}>
      <header className={s.sectionHeader}>
        <span className={s.tierBadge}>
          <InlineSvg src={`/icons/${TierIcon}`} className={'w-4 h-4'} />
        </span>
        <h2 className={s.sectionTitle}>{title}</h2>
        <span className={s.sectionCount}>
          {totalCount}
          {hasMore ? '+' : ''}
        </span>
        {showSeeAll && seeAllHref && (
          <Link href={seeAllHref} className={s.seeAll}>
            See all <ArrowRight size={13} strokeWidth={1.9} />
          </Link>
        )}
      </header>
      <div className={s.strip}>
        {React.Children.map(children, (child) => (child ? <div className={s.stripItem}>{child}</div> : null))}
        {hasMore && <div ref={sentinelRef} className={s.sentinel} />}
        {isLoadingMore && <div className={s.stripSpinner} />}
      </div>
    </section>
  );
}
