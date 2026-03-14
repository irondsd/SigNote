'use client';

import { cn } from '@/utils/cn';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import styles from './EncryptedNoteCard.module.scss';

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

function colorClass(color: string | null | undefined, styleMap: Record<string, string>): string | undefined {
  if (!color) return undefined;
  const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  return styleMap[key];
}

export function EncryptedNoteCard({
  title,
  updatedAt,
  color,
  onClick,
  decryptedContent,
  showArchivedBadge = false,
  archived = false,
}: EncryptedNoteCardProps) {
  const date = new Date(updatedAt).toLocaleDateString();

  return (
    <div
      className={cn(styles.card, colorClass(color, styles as unknown as Record<string, string>))}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      {title && <h3 className={styles.title}>{title}</h3>}

      {decryptedContent ? (
        <div className={styles.content} dangerouslySetInnerHTML={{ __html: decryptedContent }} />
      ) : (
        <div className={styles.content}>
          <EncryptedPlaceholder rows={3} />
        </div>
      )}

      {showArchivedBadge && archived && <span className={styles.archivedBadge}>Archived</span>}
      <span className={styles.date}>{date}</span>
    </div>
  );
}
