'use client';

import type { NoteDocument } from '@/models/Note';
import styles from './NoteCard.module.scss';

type NoteCardProps = {
  note: NoteDocument;
  onClick: () => void;
};

export function NoteCard({ note, onClick }: NoteCardProps) {
  const date = new Date(note.updatedAt).toLocaleDateString();

  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      {note.title && <h3 className={styles.title}>{note.title}</h3>}
      {note.content && (
        <div
          className={styles.content}
          dangerouslySetInnerHTML={{ __html: note.content }}
        />
      )}
      <span className={styles.date}>{date}</span>
    </div>
  );
}
