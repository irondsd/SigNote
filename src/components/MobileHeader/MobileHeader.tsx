'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
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
        <button
          className={styles.burger}
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
      </header>

      {/* Overlay */}
      {open && (
        <div
          className={styles.overlay}
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Slide-out drawer from right */}
      <div className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
        <button
          className={styles.closeBtn}
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        <SidebarNav onNavClick={() => setOpen(false)} />
      </div>
    </>
  );
}
