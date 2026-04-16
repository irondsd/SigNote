'use client';

import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyStateLayout } from './EmptyStateLayout';

type EmptyStateProps = {
  onNewNote?: () => void;
};

export function EmptyState({ onNewNote }: EmptyStateProps) {
  return (
    <EmptyStateLayout
      icon={<PenLine size={48} strokeWidth={1.2} />}
      heading="No notes yet"
      sub="Create your first note to get started."
      action={
        <Button className="mt-2" onClick={onNewNote}>
          <PenLine size={16} />
          Create a note
        </Button>
      }
    />
  );
}
