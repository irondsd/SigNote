'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useDisconnect, useEnsName } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { NotebookText, BookLock, SquareAsterisk, Github, BookOpen, LogOut } from 'lucide-react';
import { SignInButton } from '@/components/SignInButton/SignInButton';
import { Button } from '@/components/ui/button';
import { shortenAddress } from '@/utils/shortenAddress';
import s from './SidebarNav.module.scss';
import { Logo } from '../Logo/Logo';
import { Address } from 'viem';

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

  const address = session?.user?.address as Address | undefined;
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });

  const handleSignOut = async () => {
    disconnect();
    signOut({ redirect: false });
  };

  return (
    <nav className={s.nav}>
      <Logo className="mb-4" />
      <ul className={s.links}>
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className={`${s.link} ${pathname === href ? s.active : ''}`} onClick={onNavClick}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className={s.spacer} />

      {/* Bottom section */}
      <div className={s.bottom}>
        <div className={s.themeRow}>
          <span className={s.label}>Theme</span>
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
        </div>

        <div className={s.authSection}>
          {address ? (
            <div className={s.walletRow}>
              <Link href="/profile" className={s.walletLink} onClick={onNavClick}>
                <div className={s.walletDot} />
                <span data-testid="wallet-address" className={s.walletAddress}>
                  {ensName ?? shortenAddress(address)}
                </span>
              </Link>
              <Button
                data-testid="sign-out-button"
                variant="ghost"
                size="icon-xs"
                className="h-8 hover:bg-destructive hover:text-white"
                onClick={handleSignOut}
                title="Sign out"
              >
                <LogOut size={24} />
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
