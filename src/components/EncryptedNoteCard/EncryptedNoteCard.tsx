'use client';

import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { NoteCardBase } from '@/components/NoteCardBase/NoteCardBase';

type EncryptedNoteCardProps = {
  title: string;
  updatedAt: string;
  color: string | null | undefined;
  onClick: () => void;
  /** If provided, renders decrypted HTML preview instead of placeholder */
  decryptedContent?: string;
  showArchivedBadge?: boolean;
  archived?: boolean;
};

export function EncryptedNoteCard({
  title,
  updatedAt,
  color,
  onClick,
  decryptedContent,
  showArchivedBadge = false,
  archived = false,
}: EncryptedNoteCardProps) {
  const content = decryptedContent
    ? <div dangerouslySetInnerHTML={{ __html: decryptedContent }} />
    : <EncryptedPlaceholder rows={3} />;

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
