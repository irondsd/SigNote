'use client';

import DOMPurify from 'dompurify';
import type { NoteDocument } from '@/models/Note';
import { NoteCardBase } from '@/components/NoteCardBase/NoteCardBase';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';

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
  const hidePreview = note.burnAfterReading;
  return (
    <NoteCardBase
      title={note.title}
      updatedAt={note.updatedAt}
      color={note.color}
      pattern={note.pattern}
      onClick={onClick}
      showArchivedBadge={showArchivedBadge}
      archived={note.archived}
      pinned={note.pinned}
      hasExpiry={Boolean(note.expiresAt || note.burnAfterReading)}
      data-testid="note-card"
      content={
        hidePreview ? (
          <EncryptedPlaceholder rows={4} />
        ) : note.content ? (
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.content, PURIFY_CONFIG) }} />
        ) : undefined
      }
    />
  );
}
