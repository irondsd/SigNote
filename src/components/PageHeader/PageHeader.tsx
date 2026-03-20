'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import s from './PageHeader.module.scss';

interface PageHeaderProps {
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  showSearch?: boolean;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  search,
  onSearchChange,
  placeholder = 'Search...',
  showSearch = true,
  actions,
}: PageHeaderProps) {
  const [searchActive, setSearchActive] = useState(!!search);
  const inputRef = useRef<HTMLInputElement>(null);

  const openSearch = () => {
    setSearchActive(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeSearch = useCallback(() => {
    setSearchActive(false);
    onSearchChange('');
  }, [onSearchChange]);

  useEffect(() => {
    if (!searchActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchActive, closeSearch]);

  if (searchActive) {
    return (
      <div className={s.topBar}>
        <div className={s.searchRow} key="search">
          <Button
            variant="ghost"
            size="icon"
            onClick={closeSearch}
            aria-label="Cancel search"
            title="Cancel search"
            className={s.backBtn}
          >
            <ArrowLeft size={18} />
          </Button>
          <div className={s.inputWrap}>
            <Input
              ref={inputRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className={s.input}
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                onClick={closeSearch}
                className={s.clearBtn}
                aria-label="Clear search"
                title="Clear search"
              >
                <X size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.topBar}>
      <div className={s.normalRow} key="normal">
        <h1 className={s.title}>{title}</h1>
        <div className={s.actions}>
          {showSearch && (
            <Button variant="ghost" size="icon" onClick={openSearch} aria-label="Search" title="Search">
              <Search size={18} />
            </Button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
