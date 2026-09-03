'use client';

import type { CachedNote } from '@/hooks/useNoteMutations';
import { NoteCard } from './NoteCard';
import { SortableWrapper } from '@/components/SortableWrapper/SortableWrapper';

type SortableNoteCardProps = {
  note: CachedNote;
  onClick: (rect: DOMRect) => void;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SortableNoteCard({ note, onClick, showArchivedBadge, isDragDisabled = false }: SortableNoteCardProps) {
  return (
    <SortableWrapper id={note._id.toString()} isDragDisabled={isDragDisabled}>
      <NoteCard note={note} onClick={onClick} showArchivedBadge={showArchivedBadge} />
    </SortableWrapper>
  );
}
