'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Github, BookOpen, Heart, LogOut, UserRound } from 'lucide-react';
import { SignInButton } from '@/components/SignInButton/SignInButton';
import { Button } from '@/components/ui/button';
import { useProfile } from '@/hooks/useProfile';
import s from './SidebarNav.module.scss';
import { Logo } from '../Logo/Logo';
import { useMemo } from 'react';
import { isAddress } from 'viem';
import { shortenAddress } from '@/utils/shortenAddress';
import { InlineSvg } from '@irondsd/inline-svg';
import { clearDraft } from '@/lib/draft';
import { requestWalletDisconnect } from '@/lib/walletEvents';

const ThemeToggle = dynamic(() => import('@/components/ThemeToggle/ThemeToggle').then((mod) => mod.ThemeToggle), {
  ssr: false,
});

const NAV_LINKS = [
  { href: '/', label: 'Notes', icon: 'notes.svg' },
  { href: '/secrets', label: 'Secrets', icon: 'secrets.svg' },
  { href: '/seals', label: 'Seals', icon: 'seals.svg' },
  { href: '/auth', label: 'Auth', icon: 'auth.svg' },
];

type SidebarNavProps = {
  onNavClick?: () => void;
};

export function SidebarNav({ onNavClick }: SidebarNavProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: profile } = useProfile();

  const displayName = useMemo(() => {
    const name = profile?.displayName ?? session?.user?.name ?? undefined;

    if (name && isAddress(name)) return shortenAddress(name);

    return name;
  }, [profile, session]);

  const handleSignOut = async () => {
    clearDraft();
    requestWalletDisconnect();
    signOut({ redirect: false });
    const channel = new BroadcastChannel('signote-auth');
    channel.postMessage({ type: 'logout' });
    channel.close();
  };

  return (
    <nav className={s.nav}>
      <Logo className="mb-4" />
      <ul className={s.links}>
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={`${s.link} ${pathname === href ? s.active : ''}`}
              onClick={onNavClick}
              aria-current={pathname === href ? 'page' : undefined}
            >
              <InlineSvg src={`/icons/${Icon}`} className={'w-4.5 h-4.5'} />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className={s.spacer} />

      {/* Bottom section */}
      <div className={s.bottom}>
        <div className={s.themeRow}>
          <ThemeToggle />
        </div>

        <div className={s.externalLinks}>
          <a href="https://github.com/irondsd/signote" target="_blank" rel="noopener noreferrer" className={s.extLink}>
            <Github size={15} />
            GitHub
          </a>
          <Link href="/docs" className={s.extLink}>
            <BookOpen size={15} />
            Docs
          </Link>
          <Link href="/support" className={s.extLink} onClick={onNavClick}>
            <Heart size={15} />
            Support
          </Link>
        </div>

        <div className={s.authSection}>
          {session?.user?.id ? (
            <div className={s.walletRow}>
              <Link href="/profile" className={s.walletLink} onClick={onNavClick}>
                <span className={s.walletAvatar} aria-hidden="true">
                  <UserRound />
                </span>
                <span className={s.walletInfo}>
                  <span data-testid="display-name" className={s.walletAddress}>
                    {displayName}
                  </span>
                  <span className={s.walletHint}>View profile</span>
                </span>
              </Link>
              <Button
                data-testid="sign-out-button"
                variant="ghost"
                size="icon-sm"
                className={s.signOutButton}
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut aria-hidden="true" />
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
