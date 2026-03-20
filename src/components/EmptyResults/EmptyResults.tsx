'use client';

import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import s from '@/components/EmptyState/EmptyState.module.scss';

type EmptyResultsProps = {
  onClear: () => void;
};

export function EmptyResults({ onClear }: EmptyResultsProps) {
  return (
    <div className={s.container}>
      <div className={s.icon}>
        <SearchX size={48} strokeWidth={1.2} />
      </div>
      <h3 className={s.heading}>No results found</h3>
      <p className={s.sub}>Try a different search term.</p>
      <Button className="mt-2" variant="outline" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}
