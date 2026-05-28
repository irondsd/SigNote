'use client';

import { useMemo, useState } from 'react';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { StripShell } from './StripShell';

type NotesStripProps = {
  notes: NoteDocument[];
  totalCount: number;
  cap?: number;
  query: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onItemClick?: () => void;
};

export function NotesStrip({
  notes,
  totalCount,
  cap,
  query,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onItemClick,
}: NotesStripProps) {
  const [selected, setSelected] = useState<NoteDocument | null>(null);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const visible = useMemo(() => (cap ? notes.slice(0, cap) : notes), [notes, cap]);

  return (
    <>
      <StripShell
        title="Notes"
        totalCount={totalCount}
        seeAllHref={cap && totalCount > cap ? `/search?q=${encodeURIComponent(query)}&tiers=notes` : undefined}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
      >
        {visible.map((note) => (
          <NoteCard
            key={note._id.toString()}
            note={note}
            showArchivedBadge={note.archived}
            onClick={(rect) => {
              onItemClick?.();
              setSelected(note);
              setCardRect(rect);
            }}
          />
        ))}
      </StripShell>
      {selected && (
        <NoteModal note={selected} cardRect={cardRect ?? undefined} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
