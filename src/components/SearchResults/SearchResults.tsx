'use client';

import { useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useNotes } from '@/hooks/useNotes';
import { useSecrets } from '@/hooks/useSecrets';
import { useSeals } from '@/hooks/useSeals';
import { useEncryption } from '@/contexts/EncryptionContext';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
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
  onItemClick?: () => void;
  onClear?: () => void;
  onCountsChange?: (counts: TierCounts) => void;
};

const OVERLAY_CAP = 5;

export function SearchResults({ query, mode, tiers, onItemClick, onClear, onCountsChange }: SearchResultsProps) {
  const { data: session, status: sessionStatus } = useSession();
  const { phase } = useEncryption();
  const isAuthenticated = !!session?.user?.id;
  const vaultAvailable = isAuthenticated && (phase === 'locked' || phase === 'unlocked');

  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const showNotes = tiers.has('notes');
  const showSecrets = tiers.has('secrets');
  const showSeals = tiers.has('seals');

  // Keep `search` constant per tier and toggle `enabled` instead of repointing the
  // query to an empty search. Switching to '' would fetch (and cache) the entire tier,
  // which then briefly flashes when the tier is re-enabled before the debounced search
  // key catches up. Disabled queries simply retain their cached results.
  const notesQuery = useNotes({ archived: undefined, search: trimmed, enabled: enabled && showNotes });
  const secretsQuery = useSecrets({ archived: undefined, search: trimmed, enabled: enabled && showSecrets });
  const sealsQuery = useSeals({ archived: undefined, search: trimmed, enabled: enabled && showSeals });

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

  if (!anyLoading && totalCount === 0) {
    return <EmptyResults onClear={onClear ?? (() => undefined)} />;
  }

  const cap = mode === 'overlay' ? OVERLAY_CAP : undefined;
  const showSeeAll = mode === 'overlay';

  return (
    <div className={s.results}>
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
