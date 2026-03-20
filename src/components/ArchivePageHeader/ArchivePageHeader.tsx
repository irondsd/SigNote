import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import styles from './ArchivePageHeader.module.scss';

interface ArchivePageHeaderProps {
  title: string;
  backHref: string;
  backLabel: string;
  BackIcon: LucideIcon;
}

export function ArchivePageHeader({ title, backHref, backLabel, BackIcon }: ArchivePageHeaderProps) {
  return (
    <div className={styles.topBar}>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.actions}>
        <Link href={backHref}>
          <Button variant="ghost">
            <BackIcon size={18} />
            {backLabel}
          </Button>
        </Link>
      </div>
    </div>
  );
}
