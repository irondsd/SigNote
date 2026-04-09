'use client';

import DOMPurify from 'dompurify';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { NoteCardBase } from '@/components/NoteCardBase/NoteCardBase';

type EncryptedNoteCardProps = {
  title: string;
  updatedAt: string;
  color: string | null | undefined;
  onClick: (rect: DOMRect) => void;
  /** If provided, renders decrypted HTML preview instead of placeholder */
  decryptedContent?: string;
  /** Base64 ciphertext for deterministic placeholder layout */
  ciphertext?: string;
  showArchivedBadge?: boolean;
  archived?: boolean;
};

export function EncryptedNoteCard({
  title,
  updatedAt,
  color,
  onClick,
  decryptedContent,
  ciphertext,
  showArchivedBadge = false,
  archived = false,
}: EncryptedNoteCardProps) {
  const content = decryptedContent ? (
    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(decryptedContent) }} />
  ) : (
    <EncryptedPlaceholder rows={4} ciphertext={ciphertext} />
  );

  return (
    <NoteCardBase
      data-testid="secret-card"
      title={title}
      updatedAt={updatedAt}
      color={color}
      onClick={onClick}
      showArchivedBadge={showArchivedBadge}
      archived={archived}
      content={content}
    />
  );
}
