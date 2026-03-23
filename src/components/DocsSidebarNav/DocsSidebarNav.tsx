'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import s from './DocsSidebarNav.module.scss';
import { Logo } from '../Logo/Logo';

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
      <Logo className="mb-4" />

      <div className={s.section}>
        <span className={s.sectionLabel}>Documentation</span>
        <ul className={s.links}>
          {pages.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} className={`${s.link} ${pathname === href ? s.active : ''}`} onClick={onNavClick}>
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
