'use client';

import { MobileDrawerHeader } from '@/components/MobileDrawerHeader/MobileDrawerHeader';
import { SidebarNav } from '@/components/SidebarNav/SidebarNav';

export function MobileHeader() {
  return <MobileDrawerHeader renderNavigation={(close) => <SidebarNav onNavClick={close} />} />;
}
