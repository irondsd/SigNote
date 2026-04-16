'use client';

import { useState } from 'react';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SortableNoteCard } from '@/components/NoteCard/SortableNoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { BaseGrid } from '@/components/BaseGrid/BaseGrid';
import { getStableKey } from '@/lib/stableKeyStore';
import { useInitialNoteId } from '@/hooks/useInitialNoteId';

type NotesGridProps = {
  notes: NoteDocument[] | undefined;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function NotesGrid({
  notes,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: NotesGridProps) {
  const [selected, setSelected] = useState<NoteDocument | null>(null);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);

  useInitialNoteId(notes, (n) => n._id.toString(), setSelected);

  return (
    <BaseGrid
      notes={notes}
      getId={(note) => note._id.toString()}
      reorderType="notes"
      onLoadMore={onLoadMore}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      showArchivedBadge={showArchivedBadge}
      isDragDisabled={isDragDisabled}
      onNoteClick={(note, rect) => {
        window.history.replaceState(null, '', `${window.location.pathname}?id=${note._id.toString()}`);
        setSelected(note);
        setCardRect(rect);
      }}
      renderCard={(note, onClick, showBadge, dragDisabled) => (
        <SortableNoteCard
          key={getStableKey(note._id.toString())}
          note={note}
          onClick={onClick}
          showArchivedBadge={showBadge}
          isDragDisabled={dragDisabled}
        />
      )}
      renderOverlayCard={(note, showBadge) => <NoteCard note={note} onClick={() => {}} showArchivedBadge={showBadge} />}
    >
      {selected && (
        <NoteModal
          note={selected}
          cardRect={cardRect ?? undefined}
          onClose={() => {
            window.history.replaceState(null, '', window.location.pathname);
            setSelected(null);
            setCardRect(null);
          }}
        />
      )}
    </BaseGrid>
  );
}
