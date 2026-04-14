'use client';

import { useSession } from 'next-auth/react';
import { BookLock } from 'lucide-react';
import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { useEncryption } from '@/contexts/EncryptionContext';
import { ArchivePageHeader } from '@/components/ArchivePageHeader/ArchivePageHeader';
import s from './page.module.scss';

export default function SealsArchivePage() {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSeals({ archived: true });

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  return (
    <div className={s.page}>
      <ArchivePageHeader title="Archived Seals" backHref="/seals" backLabel="Seals" BackIcon="seals" />

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
        <SealsGrid
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
