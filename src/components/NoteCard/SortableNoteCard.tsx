'use client';

import type { NoteDocument } from '@/models/Note';
import { NoteCard } from './NoteCard';
import { SortableWrapper } from '@/components/SortableWrapper/SortableWrapper';

type SortableNoteCardProps = {
  note: NoteDocument;
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
