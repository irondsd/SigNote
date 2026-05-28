'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Search } from 'lucide-react';
import { useSearchPalette } from '@/contexts/SearchPaletteContext';
import { TierToggle, type TierSet } from '@/components/TierToggle/TierToggle';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import { RecentSearches } from '@/components/RecentSearches/RecentSearches';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import s from './SearchPalette.module.scss';

const ALL_TIERS: TierSet = new Set(['notes', 'secrets', 'seals']);

export function SearchPalette() {
  const { isOpen, query, close, setQuery } = useSearchPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [tiers, setTiers] = useState<TierSet>(new Set(ALL_TIERS));
  const [counts, setCounts] = useState<Partial<Record<'notes' | 'secrets' | 'seals', number>>>({});
  const { recents, save: saveRecent } = useRecentSearches();

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on palette open
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
    saveRecent(q);
    const tiersParam = tiers.size < ALL_TIERS.size ? `&tiers=${[...tiers].join(',')}` : '';
    router.push(`/search?q=${encodeURIComponent(q)}${tiersParam}`);
    close();
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div ref={overlayRef} className={s.overlay} role="dialog" aria-modal="true" aria-label="Search">
      {/* dim backdrop — click to close */}
      <div className={s.dim} onClick={close} aria-hidden="true" />

      {/* floating frosted glass panel */}
      <div className={s.panel}>
        {/* sticky top: header + input + filter */}
        <div className={s.panelTop}>
          <div className={s.panelHeader}>
            <button type="button" className={s.closeBtn} onClick={close} aria-label="Close search">
              <X size={20} strokeWidth={1.9} />
            </button>
            <h2 className={s.title}>Search</h2>
          </div>

          <div className={s.inputRow}>
            <div className={s.inputWrap}>
              <Search size={19} strokeWidth={1.9} className={s.inputIcon} />
              <input
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
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className={s.clearBtn}
                  aria-label="Clear search"
                >
                  <X size={15} strokeWidth={2} />
                </button>
              )}
              {query && <kbd className={s.kbd}>↵</kbd>}
            </div>
          </div>

          <div className={s.filterRow}>
            <TierToggle
              active={tiers}
              onChange={setTiers}
              counts={hasQuery ? counts : undefined}
              showCounts={hasQuery}
            />
          </div>
        </div>

        {/* scrollable results / recents */}
        <div className={s.panelBody}>
          {!hasQuery ? (
            <RecentSearches
              recents={recents}
              onPick={(q) => {
                setQuery(q);
                inputRef.current?.focus();
              }}
              onNavigate={close}
            />
          ) : (
            <SearchResults
              query={query}
              mode="overlay"
              tiers={tiers}
              onClear={() => setQuery('')}
              onCountsChange={setCounts}
            />
          )}
        </div>
      </div>
    </div>
  );
}
