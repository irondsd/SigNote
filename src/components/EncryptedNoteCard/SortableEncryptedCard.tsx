'use client';

import { EncryptedNoteCard } from './EncryptedNoteCard';
import { SortableWrapper } from '@/components/SortableWrapper/SortableWrapper';

type SortableEncryptedCardProps = {
  id: string;
  title: string;
  updatedAt: string;
  color: string | null | undefined;
  pattern?: string | null;
  onClick: (rect: DOMRect) => void;
  decryptedContent?: string;
  ciphertext?: string;
  showArchivedBadge?: boolean;
  archived?: boolean;
  isDragDisabled?: boolean;
};

export function SortableEncryptedCard({
  id,
  title,
  updatedAt,
  color,
  pattern,
  onClick,
  decryptedContent,
  ciphertext,
  showArchivedBadge,
  archived,
  isDragDisabled = false,
}: SortableEncryptedCardProps) {
  return (
    <SortableWrapper id={id} isDragDisabled={isDragDisabled}>
      <EncryptedNoteCard
        title={title}
        updatedAt={updatedAt}
        color={color}
        pattern={pattern}
        onClick={onClick}
        decryptedContent={decryptedContent}
        ciphertext={ciphertext}
        showArchivedBadge={showArchivedBadge}
        archived={archived}
      />
    </SortableWrapper>
  );
}
