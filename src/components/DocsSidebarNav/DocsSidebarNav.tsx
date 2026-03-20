'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import s from './DocsSidebarNav.module.scss';

export type DocPage = {
  slug: string;
  label: string;
  href: string;
};

type Props = {
  pages: DocPage[];
  onNavClick?: () => void;
};

export function DocsSidebarNav({ pages, onNavClick }: Props) {
  const pathname = usePathname();

  return (
    <nav className={s.nav}>
      <div className={s.logo}>
        <Link href="/" className={s.logoLink} onClick={onNavClick}>
          <div className={s.logoIcon}>✦</div>
          <span className={s.logoText}>SigNote</span>
        </Link>
      </div>

      <div className={s.section}>
        <span className={s.sectionLabel}>Documentation</span>
        <ul className={s.links}>
          {pages.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={`${s.link} ${pathname === href ? s.active : ''}`}
                onClick={onNavClick}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className={s.spacer} />

      <div className={s.bottom}>
        <Link href="/" className={s.backLink} onClick={onNavClick}>
          <ArrowLeft size={14} />
          Back to app
        </Link>
      </div>
    </nav>
  );
}
