'use client';

import { cn } from '@/utils/cn';
import type { NoteDocument } from '@/models/Note';
import styles from './NoteCard.module.scss';

type NoteCardProps = {
  note: NoteDocument;
  onClick: () => void;
  showArchivedBadge?: boolean;
};

function colorClass(color: string | null | undefined) {
  if (!color) return undefined;
  const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  return styles[key];
}

export function NoteCard({ note, onClick, showArchivedBadge = false }: NoteCardProps) {
  const date = new Date(note.updatedAt).toLocaleDateString();

  return (
    <div
      className={cn(styles.card, colorClass(note.color))}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      {note.title && <h3 className={styles.title}>{note.title}</h3>}
      {note.content && <div className={styles.content} dangerouslySetInnerHTML={{ __html: note.content }} />}
      {showArchivedBadge && note.archived && <span className={styles.archivedBadge}>Archived</span>}
      <span className={styles.date}>{date}</span>
    </div>
  );
}
