'use client';

import { type ComponentType } from 'react';
import { useSession } from 'next-auth/react';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { ArchivePageHeader } from '@/components/ArchivePageHeader/ArchivePageHeader';
import { useEncryption } from '@/contexts/EncryptionContext';
import s from './VaultPage.module.scss';

type ListQuery<T> = {
  data?: { pages: T[][] };
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  fetchNextPage: () => unknown;
};

type GridProps<T> = {
  notes: T[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  isDragDisabled?: boolean;
};

export type VaultArchivePageConfig<T> = {
  title: string;
  backHref: string;
  backLabel: string;
  backIcon: string;
  useItems: (params: { archived?: boolean }) => ListQuery<T>;
  Grid: ComponentType<GridProps<T>>;
};

/** Shared archive page for the encrypted tiers (secrets, seals). */
export function VaultArchivePage<T>({ title, backHref, backLabel, backIcon, useItems, Grid }: VaultArchivePageConfig<T>) {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useItems({ archived: true });

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  return (
    <div className={s.page}>
      <ArchivePageHeader title={title} backHref={backHref} backLabel={backLabel} BackIcon={backIcon} />

      {showLoadingState ? (
        <div className={s.loading}>
          <span className={s.spinner} />
        </div>
      ) : !isAuthenticated ? (
        <UnauthenticatedState />
      ) : phase === 'setup' ? (
        <EncryptionSetup />
      ) : notes.length === 0 ? (
        <EmptyStateArchive />
      ) : (
        <Grid
          notes={notes}
          onLoadMore={() => fetchNextPage()}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
          isDragDisabled
        />
      )}
    </div>
  );
}
