'use client';

import { useSession } from 'next-auth/react';
import { Vault } from 'lucide-react';
import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import styles from './page.module.scss';

export default function SealsArchivePage() {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSeals({ archived: true });

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <h1 className={styles.heading}>Archived Seals</h1>
        </div>
        {isAuthenticated && (
          <div className="flex gap-1">
            <Link href="/seals">
              <Button variant="ghost" size="lg">
                <Vault size={18} />
                Seals
              </Button>
            </Link>
          </div>
        )}
      </div>

      {showLoadingState ? (
        <div className={styles.loading}>
          <span className={styles.spinner} />
        </div>
      ) : !isAuthenticated ? (
        <UnauthenticatedState />
      ) : phase === 'setup' ? (
        <EncryptionSetup />
      ) : (
        <SealsGrid
          notes={notes}
          archive
          onLoadMore={() => fetchNextPage()}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
          isDragDisabled
        />
      )}
    </div>
  );
}
