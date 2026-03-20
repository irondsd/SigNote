'use client';

import { useState, useRef, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import s from './MobileHeader.module.scss';
import { SidebarNav } from '@/components/SidebarNav/SidebarNav';

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
        <div className={s.logo}>
          <span className={s.logoIcon}>✦</span>
          <span className={s.logoText}>SigNote</span>
        </div>
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
      {open && <div className={s.overlay} onClick={() => setOpen(false)} aria-hidden />}

      {/* Slide-out drawer from right */}
      <div className={`${s.drawer} ${open ? s.drawerOpen : ''}`} data-testid="mobile-drawer">
        <Button
          variant="outline"
          size="icon-sm"
          className="absolute top-[14px] right-[14px] z-[1]"
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
