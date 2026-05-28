'use client';

import { useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useNotes } from '@/hooks/useNotes';
import { useSecrets } from '@/hooks/useSecrets';
import { useSeals } from '@/hooks/useSeals';
import { useEncryption } from '@/contexts/EncryptionContext';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import type { TierSet } from '@/components/TierToggle/TierToggle';
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
  onCountsChange?: (counts: Partial<Record<'notes' | 'secrets' | 'seals', number>>) => void;
};

const OVERLAY_CAP = 5;

export function SearchResults({ query, mode, tiers, onItemClick, onClear, onCountsChange }: SearchResultsProps) {
  const { data: session } = useSession();
  const { phase } = useEncryption();
  const isAuthenticated = !!session?.user?.id;
  const vaultAvailable = isAuthenticated && (phase === 'locked' || phase === 'unlocked');

  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const showNotes = tiers.has('notes');
  const showSecrets = tiers.has('secrets');
  const showSeals = tiers.has('seals');

  const notesQuery = useNotes({ archived: undefined, search: enabled && showNotes ? trimmed : '' });
  const secretsQuery = useSecrets({ archived: undefined, search: enabled && showSecrets ? trimmed : '' });
  const sealsQuery = useSeals({ archived: undefined, search: enabled && showSeals ? trimmed : '' });

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
    onCountsChange({
      notes: showNotes ? visibleNotes.length : 0,
      secrets: showSecrets ? visibleSecrets.length : 0,
      seals: showSeals ? visibleSeals.length : 0,
    });
  }, [onCountsChange, enabled, showNotes, showSecrets, showSeals, visibleNotes.length, visibleSecrets.length, visibleSeals.length]);

  if (!enabled) return null;

  const anyLoading =
    (showNotes && notesQuery.isLoading) ||
    (showSecrets && vaultAvailable && secretsQuery.isLoading) ||
    (showSeals && vaultAvailable && sealsQuery.isLoading);
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
          hasMore={mode === 'page' ? notesQuery.hasNextPage : false}
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
          hasMore={mode === 'page' ? secretsQuery.hasNextPage : false}
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
          hasMore={mode === 'page' ? sealsQuery.hasNextPage : false}
          isLoadingMore={mode === 'page' ? sealsQuery.isFetchingNextPage : false}
        />
      )}
    </div>
  );
}
