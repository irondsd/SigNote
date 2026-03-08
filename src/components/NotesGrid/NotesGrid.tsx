'use client';

import { useRef, useState, useEffect } from 'react';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import styles from './NotesGrid.module.scss';
import { EmptyStateArchive } from '../EmptyStateArchive/EmptyStateArchive';

type NotesGridProps = {
  notes: NoteDocument[] | undefined;
  archive?: boolean;
  onNewNote?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
};

export function NotesGrid({
  notes,
  archive = false,
  onNewNote,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
}: NotesGridProps) {
  const [selected, setSelected] = useState<NoteDocument | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinelRef.current);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (!notes || notes.length === 0) {
    return archive ? <EmptyStateArchive /> : <EmptyState onNewNote={onNewNote} />;
  }

  return (
    <>
      <div className={styles.grid}>
        {notes.map((note) => (
          <NoteCard key={note._id.toString()} note={note} onClick={() => setSelected(note)} showArchivedBadge={showArchivedBadge} />
        ))}
      </div>

      {hasMore && (
        <div
          ref={sentinelRef}
          style={{
            height: '1px',
            visibility: 'hidden',
            marginTop: '20px',
          }}
          data-testid="notes-sentinel"
        />
      )}

      {isLoadingMore && (
        <div className={styles.loading}>
          <span className={styles.spinner} />
        </div>
      )}

      {selected && <NoteModal note={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
