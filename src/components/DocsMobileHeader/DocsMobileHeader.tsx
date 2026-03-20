'use client';

import { useState, useRef, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DocsSidebarNav, DocPage } from '@/components/DocsSidebarNav/DocsSidebarNav';
import s from './DocsMobileHeader.module.scss';
import { Logo } from '../Logo/Logo';

type Props = {
  pages: DocPage[];
};

export function DocsMobileHeader({ pages }: Props) {
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
      <header ref={headerRef} className={`${s.header} ${hidden ? s.headerHidden : ''}`}>
        <Logo />
        <div className={s.title}>Documentation</div>
        <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={22} />
        </Button>
      </header>

      {open && <div className={s.overlay} onClick={() => setOpen(false)} aria-hidden />}

      <div className={`${s.drawer} ${open ? s.drawerOpen : ''}`}>
        <Button
          variant="outline"
          size="icon-sm"
          className="absolute top-3.5 right-3.5 z-1"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X size={20} />
        </Button>
        <DocsSidebarNav pages={pages} onNavClick={() => setOpen(false)} />
      </div>
    </>
  );
}
