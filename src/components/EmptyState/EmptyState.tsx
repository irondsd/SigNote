'use client';

import { PenLine } from 'lucide-react';
import styles from './EmptyState.module.scss';

type EmptyStateProps = {
  onNewNote?: () => void;
};

export function EmptyState({ onNewNote }: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <PenLine size={48} strokeWidth={1.2} />
      </div>
      <h3 className={styles.heading}>No notes yet</h3>
      <p className={styles.sub}>Create your first note to get started.</p>
      <button className={styles.btn} onClick={onNewNote}>
        <PenLine size={16} />
        Create a note
      </button>
    </div>
  );
}
