'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './MobileHeader.module.scss';
import { SidebarNav } from '@/components/SidebarNav/SidebarNav';

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>✦</span>
          <span className={styles.logoText}>SigNote</span>
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
      {open && <div className={styles.overlay} onClick={() => setOpen(false)} aria-hidden />}

      {/* Slide-out drawer from right */}
      <div className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`} data-testid="mobile-drawer">
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
