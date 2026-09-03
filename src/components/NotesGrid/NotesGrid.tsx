'use client';

import { useState } from 'react';
import type { CachedNote } from '@/hooks/useNoteMutations';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SortableNoteCard } from '@/components/NoteCard/SortableNoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { BaseGrid } from '@/components/BaseGrid/BaseGrid';
import { getStableKey } from '@/lib/stableKeyStore';
import { setNoteIdParam, clearNoteIdParam } from '@/utils/noteIdUrl';
import { useInitialNoteId } from '@/hooks/useInitialNoteId';

type NotesGridProps = {
  notes: CachedNote[] | undefined;
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
  const [selected, setSelected] = useState<CachedNote | null>(null);
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
        setNoteIdParam(note._id.toString());
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
            clearNoteIdParam();
            setSelected(null);
            setCardRect(null);
          }}
        />
      )}
    </BaseGrid>
  );
}
