'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo/Logo';
import s from './MobileDrawerHeader.module.scss';

type MobileDrawerHeaderProps = {
  title?: string;
  renderNavigation: (close: () => void) => ReactNode;
};

export function MobileDrawerHeader({ title, renderNavigation }: MobileDrawerHeaderProps) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setHidden(y >= 50 && y > lastScrollY.current);
      lastScrollY.current = y;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const close = () => setOpen(false);

  return (
    <>
      <header className={`${s.header} ${hidden ? s.headerHidden : ''}`} data-testid="mobile-header">
        <Logo />
        {title && <div className={s.title}>{title}</div>}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          data-testid="mobile-menu-btn"
        >
          <Menu size={22} />
        </Button>
      </header>

      {open && <div className={s.overlay} onClick={close} aria-hidden data-drawer-open="true" />}

      <div className={`${s.drawer} ${open ? s.drawerOpen : ''}`} data-testid="mobile-drawer">
        <Button
          variant="outline"
          size="icon-sm"
          className="absolute top-3.5 right-3.5 z-1"
          onClick={close}
          aria-label="Close menu"
        >
          <X size={20} />
        </Button>
        {renderNavigation(close)}
      </div>
    </>
  );
}
