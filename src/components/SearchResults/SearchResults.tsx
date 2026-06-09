'use client';

import { useEffect, useMemo } from 'react';
import { Tag as TagIcon, CornerDownLeft } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useNotes } from '@/hooks/useNotes';
import { useSecrets } from '@/hooks/useSecrets';
import { useSeals } from '@/hooks/useSeals';
import { useTags } from '@/hooks/useTags';
import { useEncryption } from '@/contexts/EncryptionContext';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { Tag } from '@/components/Tag/Tag';
import type { TierSet, TierCounts } from '@/components/TierToggle/TierToggle';
import { NotesStrip } from './NotesStrip';
import { SecretsStrip } from './SecretsStrip';
import { SealsStrip } from './SealsStrip';
import s from './SearchResults.module.scss';

type Mode = 'overlay' | 'page';

type SearchResultsProps = {
  query: string;
  mode: Mode;
  tiers: TierSet;
  /** When set, results are scoped to this tag id across every tier. */
  tagId?: string;
  /** Picking a matching tag from the suggestions group (overlay → /search). */
  onSelectTag?: (id: string) => void;
  onItemClick?: () => void;
  onClear?: () => void;
  onCountsChange?: (counts: TierCounts) => void;
};

const OVERLAY_CAP = 5;
const MAX_TAG_SUGGESTIONS = 5;

export function SearchResults({
  query,
  mode,
  tiers,
  tagId,
  onSelectTag,
  onItemClick,
  onClear,
  onCountsChange,
}: SearchResultsProps) {
  const { data: session, status: sessionStatus } = useSession();
  const { phase } = useEncryption();
  const { tags, counts } = useTags();
  const isAuthenticated = !!session?.user?.id;
  const vaultAvailable = isAuthenticated && (phase === 'locked' || phase === 'unlocked');

  const trimmed = query.trim();
  // A tag filter alone (no text) is a valid search.
  const enabled = trimmed.length > 0 || !!tagId;
  const tagFilter = tagId ? [tagId] : undefined;

  const showNotes = tiers.has('notes');
  const showSecrets = tiers.has('secrets');
  const showSeals = tiers.has('seals');

  // Suggest tags whose name matches the typed query (only when not already
  // scoped to a tag, and only in the overlay where picking one navigates).
  const q = trimmed.toLowerCase();
  const matchingTags =
    !tagId && onSelectTag && q ? tags.filter((t) => t.name.includes(q)).slice(0, MAX_TAG_SUGGESTIONS) : [];

  // Keep `search` constant per tier and toggle `enabled` instead of repointing the
  // query to an empty search. Switching to '' would fetch (and cache) the entire tier,
  // which then briefly flashes when the tier is re-enabled before the debounced search
  // key catches up. Disabled queries simply retain their cached results.
  const notesQuery = useNotes({ archived: undefined, search: trimmed, tags: tagFilter, enabled: enabled && showNotes });
  const secretsQuery = useSecrets({
    archived: undefined,
    search: trimmed,
    tags: tagFilter,
    enabled: enabled && showSecrets,
  });
  const sealsQuery = useSeals({ archived: undefined, search: trimmed, tags: tagFilter, enabled: enabled && showSeals });

  const notes = useMemo(() => notesQuery.data?.pages.flatMap((p) => p) ?? [], [notesQuery.data?.pages]);
  const secrets = useMemo(
    () => (vaultAvailable ? secretsQuery.data?.pages.flatMap((p) => p) ?? [] : []),
    [vaultAvailable, secretsQuery.data?.pages],
  );
  const seals = useMemo(
    () => (vaultAvailable ? sealsQuery.data?.pages.flatMap((p) => p) ?? [] : []),
    [vaultAvailable, sealsQuery.data?.pages],
  );

  const visibleNotes = showNotes ? notes : [];
  const visibleSecrets = showSecrets ? secrets : [];
  const visibleSeals = showSeals ? seals : [];

  useEffect(() => {
    if (!onCountsChange || !enabled) return;
    // Only report active tiers — a deselected tier should show no badge, not "0".
    // `more` flags the count as a lower bound when further pages exist (the API has
    // no total), surfaced as a "+" suffix.
    const next: TierCounts = {};
    if (showNotes) next.notes = { count: visibleNotes.length, more: !!notesQuery.hasNextPage };
    if (showSecrets) next.secrets = { count: visibleSecrets.length, more: !!secretsQuery.hasNextPage };
    if (showSeals) next.seals = { count: visibleSeals.length, more: !!sealsQuery.hasNextPage };
    onCountsChange(next);
  }, [
    onCountsChange,
    enabled,
    showNotes,
    showSecrets,
    showSeals,
    visibleNotes.length,
    visibleSecrets.length,
    visibleSeals.length,
    notesQuery.hasNextPage,
    secretsQuery.hasNextPage,
    sealsQuery.hasNextPage,
  ]);

  if (!enabled) return null;

  // Treat prerequisite-pending states as loading so the empty state can't flash before
  // the queries are even enabled. Notes wait on the session; vault tiers wait on `phase`
  // (which already subsumes session loading). A disabled query reports isLoading === false,
  // which is why these guards are needed beyond `isLoading` alone.
  const notesLoading = showNotes && (sessionStatus === 'loading' || notesQuery.isLoading);
  const secretsLoading = showSecrets && (phase === 'loading' || (vaultAvailable && secretsQuery.isLoading));
  const sealsLoading = showSeals && (phase === 'loading' || (vaultAvailable && sealsQuery.isLoading));
  const anyLoading = notesLoading || secretsLoading || sealsLoading;
  const totalCount = visibleNotes.length + visibleSecrets.length + visibleSeals.length;

  if (!anyLoading && totalCount === 0 && matchingTags.length === 0) {
    return <EmptyResults onClear={onClear ?? (() => undefined)} />;
  }

  const cap = mode === 'overlay' ? OVERLAY_CAP : undefined;
  const showSeeAll = mode === 'overlay';

  return (
    <div className={s.results}>
      {matchingTags.length > 0 && (
        <section className={s.section} data-testid="tag-suggestions">
          <div className={s.sectionHeader}>
            <span className={s.tierBadge}>
              <TagIcon size={14} />
            </span>
            <h3 className={s.sectionTitle}>Tags</h3>
          </div>
          <div className={s.tagSuggestList}>
            {matchingTags.map((t) => (
              <button key={t._id} type="button" className={s.tagSuggestRow} onClick={() => onSelectTag?.(t._id)}>
                <Tag tag={t} size="sm" variant="soft" dot />
                <span className={s.tagSuggestHint}>
                  Filter to items tagged <b>{t.name}</b>
                  {counts[t._id] ? ` · ${counts[t._id]}` : ''}
                </span>
                <CornerDownLeft size={13} className={s.tagSuggestEnter} />
              </button>
            ))}
          </div>
        </section>
      )}
      {visibleNotes.length > 0 && (
        <NotesStrip
          notes={visibleNotes}
          totalCount={visibleNotes.length}
          cap={cap}
          query={trimmed}
          showSeeAll={showSeeAll}
          onItemClick={onItemClick}
          onLoadMore={mode === 'page' ? () => notesQuery.fetchNextPage() : undefined}
          hasMore={!!notesQuery.hasNextPage}
          isLoadingMore={mode === 'page' ? notesQuery.isFetchingNextPage : false}
        />
      )}
      {visibleSecrets.length > 0 && (
        <SecretsStrip
          notes={visibleSecrets}
          totalCount={visibleSecrets.length}
          cap={cap}
          query={trimmed}
          showSeeAll={showSeeAll}
          onItemClick={onItemClick}
          onLoadMore={mode === 'page' ? () => secretsQuery.fetchNextPage() : undefined}
          hasMore={!!secretsQuery.hasNextPage}
          isLoadingMore={mode === 'page' ? secretsQuery.isFetchingNextPage : false}
        />
      )}
      {visibleSeals.length > 0 && (
        <SealsStrip
          notes={visibleSeals}
          totalCount={visibleSeals.length}
          cap={cap}
          query={trimmed}
          showSeeAll={showSeeAll}
          onItemClick={onItemClick}
          onLoadMore={mode === 'page' ? () => sealsQuery.fetchNextPage() : undefined}
          hasMore={!!sealsQuery.hasNextPage}
          isLoadingMore={mode === 'page' ? sealsQuery.isFetchingNextPage : false}
        />
      )}
    </div>
  );
}
