'use client';

import { useSession } from 'next-auth/react';
import { ShieldCheck } from 'lucide-react';
import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import styles from './page.module.scss';

export default function SecretsArchivePage() {
  const { data: session, status } = useSession();
  const { profileStatus } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSecrets({ archived: true });

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || profileStatus === 'loading';

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <h1 className={styles.heading}>Archived Secrets</h1>
        </div>
        {isAuthenticated && (
          <div className="flex gap-1">
            <Link href="/secrets">
              <Button variant="ghost" size="lg">
                <ShieldCheck size={18} />
                Secrets
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
      ) : profileStatus === 'missing' ? (
        <EncryptionSetup />
      ) : (
        <SecretsGrid
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
