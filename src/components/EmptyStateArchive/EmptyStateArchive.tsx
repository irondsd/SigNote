'use client';

import { ArrowBigLeft, PenLine } from 'lucide-react';
import styles from './EmptyStateArchive.module.scss';
import Link from 'next/link';

export function EmptyStateArchive() {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <PenLine size={48} strokeWidth={1.2} />
      </div>
      <h3 className={styles.heading}>Your archive is empty</h3>
      <p className={styles.sub}>You haven&apos;t archived any notes yet.</p>
      <Link href="/" className={styles.btn}>
        <ArrowBigLeft size={16} /> Go back to notes
      </Link>
    </div>
  );
}
