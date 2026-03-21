'use client';

import DOMPurify from 'dompurify';
import type { NoteDocument } from '@/models/Note';
import { NoteCardBase } from '@/components/NoteCardBase/NoteCardBase';

type NoteCardProps = {
  note: NoteDocument;
  onClick: () => void;
  showArchivedBadge?: boolean;
};

export function NoteCard({ note, onClick, showArchivedBadge = false }: NoteCardProps) {
  return (
    <NoteCardBase
      title={note.title}
      updatedAt={note.updatedAt}
      color={note.color}
      onClick={onClick}
      showArchivedBadge={showArchivedBadge}
      archived={note.archived}
      data-testid="note-card"
      content={note.content ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.content) }} /> : undefined}
    />
  );
}
