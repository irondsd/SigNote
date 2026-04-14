'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [initialNoteId, setInitialNoteId] = useState<string | null>(null);
  const openedInitialRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialNoteId(new URLSearchParams(window.location.search).get('id'));
  }, []);

  useEffect(() => {
    if (!initialNoteId || openedInitialRef.current || !notes) return;
    const note = notes.find((n) => n._id === initialNoteId);
    if (!note) return;
    openedInitialRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(note);
  }, [notes, initialNoteId]);

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
      onNoteClick={(note) => {
        window.history.replaceState(null, '', `${window.location.pathname}?id=${note._id}`);
        setSelected(note);
      }}
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
      {selected && (
        <SealNoteModal
          note={selected}
          onClose={() => {
            window.history.replaceState(null, '', window.location.pathname);
            setSelected(null);
          }}
        />
      )}
    </BaseGrid>
  );
}
