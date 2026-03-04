'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useAccount } from 'wagmi';
import {
  NotebookText,
  ShieldCheck,
  Vault,
  Github,
  BookOpen,
  LogOut,
} from 'lucide-react';

import { SignInButton } from '@/components/SignInButton/SignInButton';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import { shortenAddress } from '@/utils/shortenAddress';
import styles from './SidebarNav.module.scss';

const NAV_LINKS = [
  { href: '/', label: 'Notes', icon: NotebookText },
  { href: '/secrets', label: 'Secrets', icon: ShieldCheck },
  { href: '/vaults', label: 'Vaults', icon: Vault },
];

type SidebarNavProps = {
  onNavClick?: () => void;
};

export function SidebarNav({ onNavClick }: SidebarNavProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isConnected } = useAccount();

  const address = session?.user?.address;

  return (
    <nav className={styles.nav}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>✦</div>
        <span className={styles.logoText}>SigNote</span>
      </div>

      {/* Nav links */}
      <ul className={styles.links}>
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={`${styles.link} ${pathname === href ? styles.active : ''}`}
              onClick={onNavClick}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className={styles.spacer} />

      {/* Bottom section */}
      <div className={styles.bottom}>
        <div className={styles.themeRow}>
          <span className={styles.label}>Theme</span>
          <ThemeToggle />
        </div>

        <div className={styles.externalLinks}>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.extLink}
          >
            <Github size={15} />
            GitHub
          </a>
          <a
            href="#"
            className={styles.extLink}
          >
            <BookOpen size={15} />
            Docs
          </a>
        </div>

        <div className={styles.authSection}>
          {address ? (
            <div className={styles.walletRow}>
              <div className={styles.walletInfo}>
                <div className={styles.walletDot} />
                <span className={styles.walletAddress}>
                  {shortenAddress(address)}
                </span>
              </div>
              <button
                className={styles.signOutBtn}
                onClick={() => signOut({ redirect: false })}
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <SignInButton />
          )}
        </div>
      </div>
    </nav>
  );
}
