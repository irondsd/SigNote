'use client';

import DOMPurify from 'dompurify';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { NoteCardBase } from '@/components/NoteCardBase/NoteCardBase';

type EncryptedNoteCardProps = {
  title: string;
  updatedAt: string;
  color: string | null | undefined;
  pattern?: string | null;
  onClick: (rect: DOMRect) => void;
  /** If provided, renders decrypted HTML preview instead of placeholder */
  decryptedContent?: string;
  /** Base64 ciphertext for deterministic placeholder layout */
  ciphertext?: string;
  showArchivedBadge?: boolean;
  archived?: boolean;
  pinned?: boolean;
  hasExpiry?: boolean;
  burnAfterReading?: boolean;
};

export function EncryptedNoteCard({
  title,
  updatedAt,
  color,
  pattern,
  onClick,
  decryptedContent,
  ciphertext,
  showArchivedBadge = false,
  archived = false,
  pinned = false,
  hasExpiry = false,
  burnAfterReading = false,
}: EncryptedNoteCardProps) {
  const showPlaceholder = burnAfterReading || !decryptedContent;
  const content = showPlaceholder ? (
    <EncryptedPlaceholder rows={4} ciphertext={ciphertext} />
  ) : (
    <div
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(decryptedContent!, {
          ADD_TAGS: ['div'],
          ADD_ATTR: ['data-type', 'data-file-id', 'data-filename', 'data-size', 'data-mime-type'],
        }),
      }}
    />
  );

  return (
    <NoteCardBase
      data-testid="secret-card"
      title={title}
      updatedAt={updatedAt}
      color={color}
      pattern={pattern}
      onClick={onClick}
      showArchivedBadge={showArchivedBadge}
      archived={archived}
      pinned={pinned}
      hasExpiry={hasExpiry}
      content={content}
    />
  );
}
