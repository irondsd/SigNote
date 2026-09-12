'use client';

import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyStateLayout } from './EmptyStateLayout';

/** Singular noun for the tier this list belongs to — the three tiers share this component. */
export type EmptyStateNoun = 'note' | 'secret' | 'seal';

type EmptyStateProps = {
  onNewNote?: () => void;
  noun?: EmptyStateNoun;
};

const plural: Record<EmptyStateNoun, string> = {
  note: 'notes',
  secret: 'secrets',
  seal: 'seals',
};

export function EmptyState({ onNewNote, noun = 'note' }: EmptyStateProps) {
  return (
    <EmptyStateLayout
      icon={<PenLine size={48} strokeWidth={1.2} />}
      heading={`No ${plural[noun]} yet`}
      sub={`Create your first ${noun} to get started.`}
      action={
        <Button className="mt-2" onClick={onNewNote}>
          <PenLine size={16} />
          Create a {noun}
        </Button>
      }
    />
  );
}
