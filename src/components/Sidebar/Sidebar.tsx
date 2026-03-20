'use client';

import s from './Sidebar.module.scss';
import { SidebarNav } from '@/components/SidebarNav/SidebarNav';

export function Sidebar() {
  return (
    <aside className={s.sidebar}>
      <SidebarNav />
    </aside>
  );
}
