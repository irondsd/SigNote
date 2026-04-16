'use client';

import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyStateLayout } from '@/components/EmptyState/EmptyStateLayout';

type EmptyResultsProps = {
  onClear: () => void;
};

export function EmptyResults({ onClear }: EmptyResultsProps) {
  return (
    <EmptyStateLayout
      icon={<SearchX size={48} strokeWidth={1.2} />}
      heading="No results found"
      sub="Try a different search term."
      action={
        <Button className="mt-2" variant="outline" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}
