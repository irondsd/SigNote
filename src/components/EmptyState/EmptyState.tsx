'use client';

import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import s from './EmptyState.module.scss';

type EmptyStateProps = {
  onNewNote?: () => void;
};

export function EmptyState({ onNewNote }: EmptyStateProps) {
  return (
    <div className={s.container}>
      <div className={s.icon}>
        <PenLine size={48} strokeWidth={1.2} />
      </div>
      <h3 className={s.heading}>No notes yet</h3>
      <p className={s.sub}>Create your first note to get started.</p>
      <Button className="mt-2" onClick={onNewNote}>
        <PenLine size={16} />
        Create a note
      </Button>
    </div>
  );
}
