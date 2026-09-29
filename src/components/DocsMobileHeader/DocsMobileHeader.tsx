'use client';

import { DocsSidebarNav, type DocPage } from '@/components/DocsSidebarNav/DocsSidebarNav';
import { MobileDrawerHeader } from '@/components/MobileDrawerHeader/MobileDrawerHeader';

type Props = {
  pages: DocPage[];
};

export function DocsMobileHeader({ pages }: Props) {
  return (
    <MobileDrawerHeader
      title="Documentation"
      renderNavigation={(close) => <DocsSidebarNav pages={pages} onNavClick={close} />}
    />
  );
}
