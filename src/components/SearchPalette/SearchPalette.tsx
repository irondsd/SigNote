'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Search, Tag as TagIcon } from 'lucide-react';
import { useSearchPalette } from '@/contexts/SearchPaletteContext';
import { EncryptionProvider } from '@/contexts/EncryptionContext';
import { TierToggle, type TierSet, type TierCounts } from '@/components/TierToggle/TierToggle';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import { RecentSearches } from '@/components/RecentSearches/RecentSearches';
import { Tag } from '@/components/Tag/Tag';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { useTags } from '@/hooks/useTags';
import { cn } from '@/utils/cn';
import s from './SearchPalette.module.scss';

const ALL_TIERS: TierSet = new Set(['notes', 'secrets', 'seals']);
const MAX_POPULAR_TAGS = 8;

export function SearchPalette() {
  const { isOpen, query, close, setQuery } = useSearchPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [tiers, setTiers] = useState<TierSet>(new Set(ALL_TIERS));
  const [counts, setCounts] = useState<TierCounts>({});
  // Active tag token shown inside the input; filters results in place.
  const [tagId, setTagId] = useState('');
  // `exiting` keeps the panel mounted while it animates into the page (the
  // context clears `isOpen`/`query` on the route change); `exitQuery` freezes
  // the displayed content so it doesn't flash empty mid-animation.
  const [exiting, setExiting] = useState(false);
  const [exitQuery, setExitQuery] = useState('');
  const { recents, save: saveRecent } = useRecentSearches();
  const { tags, counts: tagCounts, byId } = useTags();

  const popularTags = useMemo(
    () => [...tags].sort((a, b) => (tagCounts[b._id] ?? 0) - (tagCounts[a._id] ?? 0)).slice(0, MAX_POPULAR_TAGS),
    [tags, tagCounts],
  );

  // Picking a tag adds it as a token and clears the text used to find it (typing
  // "work" to locate the tag shouldn't then also require "work" in the body).
  const selectTag = useCallback(
    (id: string) => {
      setQuery('');
      setTagId(id);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [setQuery],
  );

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on palette open
    setTiers(new Set(ALL_TIERS));
    setTagId('');
    router.prefetch('/search');
    requestAnimationFrame(() => inputRef.current?.focus());

    const contentEl = overlayRef.current?.parentElement;
    if (contentEl) {
      contentEl.style.overflow = 'hidden';
      return () => {
        contentEl.style.overflow = '';
      };
    }
  }, [isOpen, router]);

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

  if (!isOpen && !exiting) return null;

  const submit = () => {
    const q = query.trim();
    if (!q && !tagId) return;
    if (q) saveRecent(q);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tagId) params.set('tag', tagId);
    if (tiers.size < ALL_TIERS.size) params.set('tiers', [...tiers].join(','));
    const url = `/search?${params.toString()}`;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      router.push(url);
      close();
      return;
    }

    // Hand off to the page: snapshot the query so content stays put, navigate
    // underneath, animate the panel out, then unmount once it lands.
    setExitQuery(q);
    setExiting(true);
    router.push(url);
    setTimeout(() => {
      setExiting(false);
      close();
    }, 320);
  };

  // While exiting, the context has cleared `query`; render from the snapshot.
  const activeQuery = exiting ? exitQuery : query;
  const hasQuery = activeQuery.trim().length > 0;
  const activeTag = tagId ? byId.get(tagId) : undefined;
  const hasFilter = hasQuery || !!tagId;

  return (
    <div ref={overlayRef} className={s.overlay} role="dialog" aria-modal="true" aria-label="Search">
      {/* dim backdrop — click to close */}
      <div className={cn(s.dim, exiting && s.dimExiting)} onClick={close} aria-hidden="true" />

      {/* floating frosted glass panel */}
      <div className={cn(s.panel, exiting && s.panelExiting)}>
        {/* sticky top: header + input + filter */}
        <div className={s.panelTop}>
          <button type="button" className={s.closeBtn} onClick={close} aria-label="Close search">
            <X size={20} strokeWidth={1.9} />
          </button>

          <div className={s.panelHeader}>
            <div className={s.titleRow}>
              <h2 className={s.title}>Search</h2>
            </div>

            <div className={s.inputWrap}>
              <Search size={19} strokeWidth={1.9} className={s.inputIcon} />
              {activeTag && <Tag tag={activeTag} size="sm" variant="soft" dot onRemove={() => setTagId('')} />}
              <input
                ref={inputRef}
                value={activeQuery}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  } else if (e.key === 'Backspace' && !activeQuery && tagId) {
                    setTagId('');
                  }
                }}
                placeholder={activeTag ? '' : 'Search notes, secrets, and seals'}
                aria-label="Search"
                className={s.input}
              />
              {activeQuery && (
                <button type="button" onClick={() => setQuery('')} className={s.clearBtn} aria-label="Clear search">
                  <X size={15} strokeWidth={2} />
                </button>
              )}
              {activeQuery && (
                <button
                  type="button"
                  className={s.kbd}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={submit}
                  aria-label="Go to search results"
                >
                  ↵
                </button>
              )}
            </div>

            <div className={s.filterRow}>
              <TierToggle
                active={tiers}
                onChange={setTiers}
                counts={hasFilter ? counts : undefined}
                showCounts={hasFilter}
              />
            </div>
          </div>
        </div>

        {/* scrollable results / recents */}
        <div className={s.panelBody}>
          {!hasFilter ? (
            <>
              <RecentSearches
                recents={recents}
                onPick={(q) => {
                  setQuery(q);
                  inputRef.current?.focus();
                }}
                onNavigate={close}
              />
              {popularTags.length > 0 && (
                <div className={s.tagFilterSection}>
                  <div className={s.tagFilterLabel}>
                    <TagIcon size={14} />
                    <span>Filter by tag</span>
                  </div>
                  <div className={s.tagFilterChips}>
                    {popularTags.map((t) => (
                      <Tag key={t._id} tag={t} size="md" variant="soft" dot onClick={() => selectTag(t._id)} />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <EncryptionProvider>
              <SearchResults
                query={activeQuery}
                mode="overlay"
                tiers={tiers}
                tagId={tagId || undefined}
                onSelectTag={selectTag}
                // Opening a result means the user found what they searched for,
                // so save the query even though they never pressed enter.
                onItemClick={() => activeQuery.trim() && saveRecent(activeQuery)}
                onClear={() => {
                  setQuery('');
                  setTagId('');
                }}
                onCountsChange={setCounts}
              />
            </EncryptionProvider>
          )}
        </div>
      </div>
    </div>
  );
}
