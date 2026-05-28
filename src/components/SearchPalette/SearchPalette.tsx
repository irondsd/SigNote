'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearchPalette } from '@/contexts/SearchPaletteContext';
import { TierToggle, type TierSet } from '@/components/TierToggle/TierToggle';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import s from './SearchPalette.module.scss';

const ALL_TIERS: TierSet = new Set(['notes', 'secrets', 'seals']);

export function SearchPalette() {
  const { isOpen, query, close, setQuery } = useSearchPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [tiers, setTiers] = useState<TierSet>(new Set(ALL_TIERS));

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset tiers when palette opens
    setTiers(new Set(ALL_TIERS));
    requestAnimationFrame(() => inputRef.current?.focus());

    const contentEl = overlayRef.current?.parentElement;
    if (contentEl) {
      contentEl.style.overflow = 'hidden';
      return () => {
        contentEl.style.overflow = '';
      };
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [close],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    const tiersParam = tiers.size < ALL_TIERS.size ? `&tiers=${[...tiers].join(',')}` : '';
    router.push(`/search?q=${encodeURIComponent(q)}${tiersParam}`);
    close();
  };

  return (
    <div ref={overlayRef} className={s.overlay} role="dialog" aria-modal="true" aria-label="Search">
      <div className={s.topBar}>
        <div className={s.topRow}>
          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label="Close search"
            title="Close search"
            className={s.backBtn}
          >
            <ArrowLeft size={18} />
          </Button>
          <h2 className={s.title}>Search</h2>
        </div>
        <div className={s.inputWrap}>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Search notes, secrets, and seals"
            aria-label="Search"
            className={s.input}
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuery('')}
              className={s.clearBtn}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={16} />
            </Button>
          )}
        </div>
        <TierToggle active={tiers} onChange={setTiers} />
      </div>
      <div className={s.body}>
        <SearchResults query={query} mode="overlay" tiers={tiers} onClear={() => setQuery('')} />
      </div>
    </div>
  );
}
