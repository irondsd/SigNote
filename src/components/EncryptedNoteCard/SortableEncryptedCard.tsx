'use client';

import { EncryptedNoteCard } from './EncryptedNoteCard';
import { SortableWrapper } from '@/components/SortableWrapper/SortableWrapper';

type SortableEncryptedCardProps = {
  id: string;
  title: string;
  updatedAt: string;
  color: string | null | undefined;
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
        onClick={onClick}
        decryptedContent={decryptedContent}
        ciphertext={ciphertext}
        showArchivedBadge={showArchivedBadge}
        archived={archived}
      />
    </SortableWrapper>
  );
}
