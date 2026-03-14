'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useDisconnect } from 'wagmi';
import { NotebookText, BookLock, SquareAsterisk, Github, BookOpen, LogOut } from 'lucide-react';
import { SignInButton } from '@/components/SignInButton/SignInButton';
import { Button } from '@/components/ui/button';
import { shortenAddress } from '@/utils/shortenAddress';
import styles from './SidebarNav.module.scss';

const ThemeToggle = dynamic(() => import('@/components/ThemeToggle/ThemeToggle').then((mod) => mod.ThemeToggle), {
  ssr: false,
});

const NAV_LINKS = [
  { href: '/', label: 'Notes', icon: NotebookText },
  { href: '/secrets', label: 'Secrets', icon: SquareAsterisk },
  { href: '/seals', label: 'Seals', icon: BookLock },
];

type SidebarNavProps = {
  onNavClick?: () => void;
};

export function SidebarNav({ onNavClick }: SidebarNavProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { disconnect } = useDisconnect();

  const address = session?.user?.address;

  const handleSignOut = async () => {
    disconnect();
    signOut({ redirect: false });
  };

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
            href="https://github.com/irondsd/signote"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.extLink}
          >
            <Github size={15} />
            GitHub
          </a>
          <a href="#" className={styles.extLink}>
            <BookOpen size={15} />
            Docs
          </a>
        </div>

        <div className={styles.authSection}>
          {address ? (
            <div className={styles.walletRow}>
              <div className={styles.walletInfo}>
                <div className={styles.walletDot} />
                <span data-testid="wallet-address" className={styles.walletAddress}>{shortenAddress(address)}</span>
              </div>
              <Button
                data-testid="sign-out-button"
                variant="ghost"
                size="icon-xs"
                className="hover:bg-destructive hover:text-white"
                onClick={handleSignOut}
                title="Sign out"
              >
                <LogOut size={15} />
              </Button>
            </div>
          ) : (
            <SignInButton />
          )}
        </div>
      </div>
    </nav>
  );
}
