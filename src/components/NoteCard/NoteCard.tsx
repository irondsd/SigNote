'use client';

import type { NoteDocument } from '@/models/Note';
import styles from './NoteCard.module.scss';

type NoteCardProps = {
  note: NoteDocument;
  onClick: () => void;
};

export function NoteCard({ note, onClick }: NoteCardProps) {
  const date = new Date(note.createdAt).toLocaleDateString();

  return (
    <button className={styles.card} onClick={onClick}>
      {note.title && <h3 className={styles.title}>{note.title}</h3>}
      {note.content && <p className={styles.content}>{note.content}</p>}
      <span className={styles.date}>{date}</span>
    </button>
  );
}
