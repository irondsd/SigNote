'use client';

import { Search } from 'lucide-react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { useSearchPalette } from '@/contexts/SearchPaletteContext';
import s from './PageHeader.module.scss';

type PageHeaderProps = {
  title: string;
  showSearch?: boolean;
  actions?: React.ReactNode;
};

export function PageHeader({ title, actions, showSearch = true }: PageHeaderProps) {
  const { open } = useSearchPalette();

  const handleOpen = () => {
    posthog.capture('search_opened', { page: title.toLowerCase() });
    open();
  };

  return (
    <div className={s.topBar}>
      <div className={s.normalRow}>
        <h1 className={s.title}>{title}</h1>
        <div className={s.actions}>
          {showSearch && (
            <Button variant="ghost" size="icon" onClick={handleOpen} aria-label="Search" title="Search">
              <Search size={18} />
            </Button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
