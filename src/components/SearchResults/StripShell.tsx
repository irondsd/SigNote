'use client';

import React, { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import s from './SearchResults.module.scss';

type StripShellProps = {
  title: string;
  totalCount: number;
  seeAllHref?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  children: ReactNode;
};

export function StripShell({ title, totalCount, seeAllHref, onLoadMore, hasMore, isLoadingMore, children }: StripShellProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

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
        <h2 className={s.sectionTitle}>
          {title}
          <span className={s.sectionCount}>({totalCount})</span>
        </h2>
        {seeAllHref && (
          <Link href={seeAllHref} className={s.seeAll}>
            See all →
          </Link>
        )}
      </header>
      <div className={s.strip}>
        {React.Children.map(children, (child) =>
          child ? (
            <div className={s.stripItem}>{child}</div>
          ) : null,
        )}
        {hasMore && <div ref={sentinelRef} className={s.sentinel} />}
        {isLoadingMore && <div className={s.stripSpinner} />}
      </div>
    </section>
  );
}
