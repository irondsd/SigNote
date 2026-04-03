'use client';

import { useState } from 'react';
import { type CachedSealNote } from '@/hooks/useSealMutations';
import { SortableEncryptedCard } from '@/components/EncryptedNoteCard/SortableEncryptedCard';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SealNoteModal } from '@/components/SealNoteModal/SealNoteModal';
import { BaseGrid } from '@/components/BaseGrid/BaseGrid';
import { getStableKey } from '@/lib/stableKeyStore';

type SealsGridProps = {
  notes: CachedSealNote[] | undefined;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SealsGrid({
  notes,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: SealsGridProps) {
  const [selected, setSelected] = useState<CachedSealNote | null>(null);

  return (
    <BaseGrid
      notes={notes}
      getId={(note) => note._id}
      reorderType="seals"
      onLoadMore={onLoadMore}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      showArchivedBadge={showArchivedBadge}
      isDragDisabled={isDragDisabled}
      onNoteClick={(note) => setSelected(note)}
      renderCard={(note, onClick, showBadge, dragDisabled) => (
        <SortableEncryptedCard
          key={getStableKey(note._id)}
          id={note._id}
          title={note.title}
          updatedAt={note.updatedAt}
          color={note.color}
          onClick={onClick}
          ciphertext={note.encryptedBody?.ciphertext}
          showArchivedBadge={showBadge}
          archived={note.archived}
          isDragDisabled={dragDisabled}
        />
      )}
      renderOverlayCard={(note, showBadge) => (
        <EncryptedNoteCard
          title={note.title}
          updatedAt={note.updatedAt}
          color={note.color}
          onClick={() => {}}
          ciphertext={note.encryptedBody?.ciphertext}
          showArchivedBadge={showBadge}
          archived={note.archived}
        />
      )}
    >
      {selected && <SealNoteModal note={selected} onClose={() => setSelected(null)} />}
    </BaseGrid>
  );
}
