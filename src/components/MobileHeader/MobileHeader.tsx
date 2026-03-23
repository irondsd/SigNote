'use client';

import { useState, useRef, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import s from './MobileHeader.module.scss';
import { SidebarNav } from '@/components/SidebarNav/SidebarNav';
import { Logo } from '../Logo/Logo';

export function MobileHeader() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      if (y < 50) {
        setHidden(false);
      } else {
        setHidden(y > lastScrollY.current);
      }
      lastScrollY.current = y;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <header ref={headerRef} className={`${s.header} ${hidden ? s.headerHidden : ''}`} data-testid="mobile-header">
        <Logo />
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

      {/* Overlay */}
      {open && <div className={s.overlay} onClick={() => setOpen(false)} aria-hidden data-drawer-open="true" />}

      {/* Slide-out drawer from right */}
      <div className={`${s.drawer} ${open ? s.drawerOpen : ''}`} data-testid="mobile-drawer">
        <Button
          variant="outline"
          size="icon-sm"
          className="absolute top-3.5 right-3.5 z-1"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X size={20} />
        </Button>
        <SidebarNav onNavClick={() => setOpen(false)} />
      </div>
    </>
  );
}
