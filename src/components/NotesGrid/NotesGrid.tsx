'use client';

import { useState } from 'react';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import styles from './NotesGrid.module.scss';
import { EmptyStateArchive } from '../EmptyStateArchive/EmptyStateArchive';

type NotesGridProps = {
  notes: NoteDocument[];
  archive?: boolean;
  onNewNote: () => void;
};

export function NotesGrid({ notes, archive = false, onNewNote }: NotesGridProps) {
  const [selected, setSelected] = useState<NoteDocument | null>(null);

  if (notes.length === 0) {
    return archive ? <EmptyStateArchive /> : <EmptyState onNewNote={onNewNote} />;
  }

  return (
    <>
      <div className={styles.grid}>
        {notes.map((note) => (
          <NoteCard key={note._id.toString()} note={note} onClick={() => setSelected(note)} />
        ))}
      </div>

      {selected && <NoteModal note={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
