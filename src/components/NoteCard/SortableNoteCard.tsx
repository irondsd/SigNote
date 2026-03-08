'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from './NoteCard';

type SortableNoteCardProps = {
  note: NoteDocument;
  onClick: () => void;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SortableNoteCard({ note, onClick, showArchivedBadge, isDragDisabled = false }: SortableNoteCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: note._id.toString(),
    disabled: isDragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <NoteCard note={note} onClick={onClick} showArchivedBadge={showArchivedBadge} />
    </div>
  );
}
