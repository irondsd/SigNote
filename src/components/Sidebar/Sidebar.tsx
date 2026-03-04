'use client';

import styles from './Sidebar.module.scss';
import { SidebarNav } from '@/components/SidebarNav/SidebarNav';

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <SidebarNav />
    </aside>
  );
}
