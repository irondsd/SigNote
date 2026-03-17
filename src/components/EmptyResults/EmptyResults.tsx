'use client';

import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from '@/components/EmptyState/EmptyState.module.scss';

type EmptyResultsProps = {
  onClear: () => void;
};

export function EmptyResults({ onClear }: EmptyResultsProps) {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <SearchX size={48} strokeWidth={1.2} />
      </div>
      <h3 className={styles.heading}>No results found</h3>
      <p className={styles.sub}>Try a different search term.</p>
      <Button className="mt-2" variant="outline" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}
