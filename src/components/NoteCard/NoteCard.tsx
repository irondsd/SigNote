'use client';

import DOMPurify from 'dompurify';
import type { NoteDocument } from '@/models/Note';
import { NoteCardBase } from '@/components/NoteCardBase/NoteCardBase';

const PURIFY_CONFIG = {
  ADD_TAGS: ['div'],
  ADD_ATTR: ['data-type', 'data-file-id', 'data-filename', 'data-size', 'data-mime-type'],
};

type NoteCardProps = {
  note: NoteDocument;
  onClick: (rect: DOMRect) => void;
  showArchivedBadge?: boolean;
};

export function NoteCard({ note, onClick, showArchivedBadge = false }: NoteCardProps) {
  return (
    <NoteCardBase
      title={note.title}
      updatedAt={note.updatedAt}
      color={note.color}
      pattern={note.pattern}
      onClick={onClick}
      showArchivedBadge={showArchivedBadge}
      archived={note.archived}
      data-testid="note-card"
      content={
        note.content ? (
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.content, PURIFY_CONFIG) }} />
        ) : undefined
      }
    />
  );
}
