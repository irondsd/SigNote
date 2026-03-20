'use client';

import { ArrowBigLeft, PenLine } from 'lucide-react';
import s from './EmptyStateArchive.module.scss';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function EmptyStateArchive() {
  const pathname = usePathname();
  const backHref = pathname.replace(/\/archive$/, '') || '/';

  return (
    <div className={s.container}>
      <div className={s.icon}>
        <PenLine size={48} strokeWidth={1.2} />
      </div>
      <h3 className={s.heading}>Your archive is empty</h3>
      <p className={s.sub}>You haven&apos;t archived any notes yet.</p>
      <Link href={backHref} className={s.btn}>
        <ArrowBigLeft size={16} /> Go back
      </Link>
    </div>
  );
}
