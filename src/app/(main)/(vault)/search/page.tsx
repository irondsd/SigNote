'use client';

import { Suspense, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { TierToggle, type TierSet } from '@/components/TierToggle/TierToggle';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import { RecentSearches } from '@/components/RecentSearches/RecentSearches';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import s from './page.module.scss';

const ALL_TIERS: TierSet = new Set(['notes', 'secrets', 'seals']);
const VALID = new Set(['notes', 'secrets', 'seals']);

function parseTiers(raw: string | null): TierSet {
  if (!raw) return new Set(ALL_TIERS);
  const parts = raw.split(',').filter((t) => VALID.has(t)) as Array<'notes' | 'secrets' | 'seals'>;
  return parts.length > 0 ? new Set(parts) : new Set(ALL_TIERS);
}

function encodeTiers(tiers: TierSet): string | null {
  if (tiers.size === ALL_TIERS.size) return null;
  return [...tiers].join(',');
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const tiers = useMemo(() => parseTiers(searchParams.get('tiers')), [searchParams]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<Partial<Record<'notes' | 'secrets' | 'seals', number>>>({});
  const { recents, save: saveRecent } = useRecentSearches();

  // Local input state keeps typing instant; URL updates are debounced so we
  // don't fire a router.replace (full route re-render) on every keystroke.
  const [inputValue, setInputValue] = useState(q);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Sync local input when the query changes externally (recents pick, clear,
  // browser back/forward).
  useEffect(() => {
    setInputValue(q);
  }, [q]);

  const updateParams = useCallback(
    (updates: { q?: string; tiers?: TierSet }) => {
      const params = new URLSearchParams(searchParams.toString());
      if ('q' in updates) {
        if (updates.q) params.set('q', updates.q);
        else params.delete('q');
      }
      if ('tiers' in updates) {
        const encoded = encodeTiers(updates.tiers!);
        if (encoded) params.set('tiers', encoded);
        else params.delete('tiers');
      }
      router.replace(`/search${params.toString() ? `?${params.toString()}` : ''}`);
    },
    [router, searchParams],
  );

  // Debounce the URL update while typing.
  useEffect(() => {
    if (inputValue === q) return;
    const t = setTimeout(() => updateParams({ q: inputValue }), 200);
    return () => clearTimeout(t);
  }, [inputValue, q, updateParams]);

  const hasQuery = q.trim().length > 0;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.titleRow}>
          <h1 className={s.title}>Search</h1>
        </div>

        <div className={s.inputWrap}>
          <Search size={19} strokeWidth={1.9} className={s.inputIcon} />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) {
                const trimmed = inputValue.trim();
                saveRecent(trimmed);
                updateParams({ q: trimmed });
              }
            }}
            placeholder="Search notes, secrets, and seals"
            aria-label="Search"
            className={s.input}
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue('');
                updateParams({ q: '' });
              }}
              className={s.clearBtn}
              aria-label="Clear search"
            >
              <X size={15} strokeWidth={2} />
            </button>
          )}
        </div>

        <div className={s.filterRow}>
          <TierToggle
            active={tiers}
            onChange={(next) => updateParams({ tiers: next })}
            counts={hasQuery ? counts : undefined}
            showCounts={hasQuery}
          />
        </div>
      </div>

      {!hasQuery ? (
        <div className={s.body}>
          <RecentSearches recents={recents} onPick={(term) => updateParams({ q: term })} />
        </div>
      ) : (
        <div className={s.body}>
          <SearchResults
            query={q}
            mode="page"
            tiers={tiers}
            onClear={() => updateParams({ q: '' })}
            onCountsChange={setCounts}
          />
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageContent />
    </Suspense>
  );
}
