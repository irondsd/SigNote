'use client';

import { Suspense, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Tag as TagIcon } from 'lucide-react';
import { TierToggle, type TierSet, type TierCounts } from '@/components/TierToggle/TierToggle';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import { RecentSearches } from '@/components/RecentSearches/RecentSearches';
import { Tag } from '@/components/Tag/Tag';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { useTags } from '@/hooks/useTags';
import s from './page.module.scss';

const ALL_TIERS: TierSet = new Set(['notes', 'secrets', 'seals']);
const VALID = new Set(['notes', 'secrets', 'seals']);
const MAX_POPULAR_TAGS = 8;

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
  const tag = searchParams.get('tag') ?? '';
  const tiers = useMemo(() => parseTiers(searchParams.get('tiers')), [searchParams]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<TierCounts>({});
  const { recents, save: saveRecent } = useRecentSearches();
  const { tags, counts: tagCounts, byId } = useTags();
  const tagObj = tag ? byId.get(tag) : undefined;

  const popularTags = useMemo(
    () => [...tags].sort((a, b) => (tagCounts[b._id] ?? 0) - (tagCounts[a._id] ?? 0)).slice(0, MAX_POPULAR_TAGS),
    [tags, tagCounts],
  );

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
    (updates: { q?: string; tiers?: TierSet; tag?: string | null }) => {
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
      if ('tag' in updates) {
        if (updates.tag) params.set('tag', updates.tag);
        else params.delete('tag');
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
  const hasFilter = hasQuery || !!tag;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.titleRow}>
          <h1 className={s.title}>Search</h1>
        </div>

        <div className={s.inputWrap}>
          <Search size={19} strokeWidth={1.9} className={s.inputIcon} />
          {tagObj && <Tag tag={tagObj} size="sm" variant="soft" dot onRemove={() => updateParams({ tag: null })} />}
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
            placeholder={tagObj ? '' : 'Search notes, secrets, and seals'}
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
            counts={hasFilter ? counts : undefined}
            showCounts={hasFilter}
          />
        </div>
      </div>

      {!hasFilter ? (
        <div className={s.body}>
          <RecentSearches recents={recents} onPick={(term) => updateParams({ q: term })} />
          {popularTags.length > 0 && (
            <div className={s.tagFilterSection}>
              <div className={s.tagFilterLabel}>
                <TagIcon size={14} />
                <span>Filter by tag</span>
              </div>
              <div className={s.tagFilterChips}>
                {popularTags.map((t) => (
                  <Tag
                    key={t._id}
                    tag={t}
                    size="md"
                    variant="soft"
                    dot
                    onClick={() => {
                      setInputValue('');
                      updateParams({ tag: t._id, q: '' });
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={s.body}>
          <SearchResults
            query={q}
            mode="page"
            tiers={tiers}
            tagId={tag || undefined}
            onSelectTag={(id) => {
              setInputValue('');
              updateParams({ tag: id, q: '' });
            }}
            onClear={() => {
              setInputValue('');
              updateParams({ q: '', tag: null });
            }}
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
