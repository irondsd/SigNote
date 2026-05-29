'use client';

import { useMemo, useState } from 'react';
import { type CachedSealNote } from '@/hooks/useSealMutations';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SealNoteModal } from '@/components/SealNoteModal/SealNoteModal';
import { StripShell } from './StripShell';

type SealsStripProps = {
  notes: CachedSealNote[];
  totalCount: number;
  cap?: number;
  query: string;
  showSeeAll?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onItemClick?: () => void;
};

export function SealsStrip({
  notes,
  totalCount,
  cap,
  query,
  showSeeAll,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onItemClick,
}: SealsStripProps) {
  const [selected, setSelected] = useState<CachedSealNote | null>(null);
  const visible = useMemo(() => (cap ? notes.slice(0, cap) : notes), [notes, cap]);

  return (
    <>
      <StripShell
        tier="seals"
        title="Seals"
        totalCount={totalCount}
        showSeeAll={showSeeAll}
        seeAllHref={`/search?q=${encodeURIComponent(query)}&tiers=seals`}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
      >
        {visible.map((note) => (
          <EncryptedNoteCard
            key={note._id}
            title={note.title}
            updatedAt={note.updatedAt}
            color={note.color}
            pattern={note.pattern}
            onClick={() => {
              onItemClick?.();
              setSelected(note);
            }}
            ciphertext={note.encryptedBody?.ciphertext}
            showArchivedBadge={note.archived}
            archived={note.archived}
            pinned={note.pinned}
            hasExpiry={Boolean(note.expiresAt || note.burnAfterReading)}
          />
        ))}
      </StripShell>
      {selected && <SealNoteModal note={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
