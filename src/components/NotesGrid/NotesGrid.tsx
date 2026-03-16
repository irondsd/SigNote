'use client';

import { useState } from 'react';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SortableNoteCard } from '@/components/NoteCard/SortableNoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { BaseGrid } from '@/components/BaseGrid/BaseGrid';

type NotesGridProps = {
  notes: NoteDocument[] | undefined;
  archive?: boolean;
  onNewNote?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function NotesGrid({
  notes,
  archive = false,
  onNewNote,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: NotesGridProps) {
  const [selected, setSelected] = useState<NoteDocument | null>(null);

  return (
    <BaseGrid
      notes={notes}
      getId={(note) => note._id.toString()}
      reorderType="notes"
      archive={archive}
      onNewNote={onNewNote}
      onLoadMore={onLoadMore}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      showArchivedBadge={showArchivedBadge}
      isDragDisabled={isDragDisabled}
      onNoteClick={(note) => setSelected(note)}
      renderCard={(note, onClick, showBadge, dragDisabled) => (
        <SortableNoteCard
          key={note._id.toString()}
          note={note}
          onClick={onClick}
          showArchivedBadge={showBadge}
          isDragDisabled={dragDisabled}
        />
      )}
      renderOverlayCard={(note, showBadge) => <NoteCard note={note} onClick={() => {}} showArchivedBadge={showBadge} />}
    >
      {selected && <NoteModal note={selected} onClose={() => setSelected(null)} />}
    </BaseGrid>
  );
}
