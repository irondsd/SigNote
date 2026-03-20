'use client';

import { useSession } from 'next-auth/react';
import { SquareAsterisk } from 'lucide-react';
import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { useEncryption } from '@/contexts/EncryptionContext';
import { ArchivePageHeader } from '@/components/ArchivePageHeader/ArchivePageHeader';
import s from './page.module.scss';

export default function SecretsArchivePage() {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSecrets({ archived: true });

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  return (
    <div className={s.page}>
      <ArchivePageHeader title="Archived Secrets" backHref="/secrets" backLabel="Secrets" BackIcon={SquareAsterisk} />

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
        <SecretsGrid
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
