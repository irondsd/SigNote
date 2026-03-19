'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Archive, Lock, LockOpen, Search, CircleXIcon } from 'lucide-react';
import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { NewSecretModal } from '@/components/NewSecretModal/NewSecretModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import styles from './page.module.scss';

export default function SecretsPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const { phase, lock } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [search, setSearch] = useState('');
  const { data, isFetchingNextPage, hasNextPage, fetchNextPage } = useSecrets({
    archived: search ? undefined : false,
    search,
  });
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showNewSecret, setShowNewSecret] = useState(false);
  const [openNewAfterUnlock, setOpenNewAfterUnlock] = useState(false);

  useEffect(() => {
    if (searchParams.has('draft')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to router.push URL change is intentional, not cascading
      setShowNewSecret(true);
      window.history.replaceState({}, '', '/secrets');
    }
  }, [searchParams]);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = status === 'loading' || (status === 'authenticated' && phase === 'loading');

  const handleNewSecret = () => {
    if (!isUnlocked) {
      setOpenNewAfterUnlock(true);
      setShowPassphrase(true);
      return;
    }
    setShowNewSecret(true);
  };

  const handleUnlockSuccess = () => {
    setShowPassphrase(false);
    if (openNewAfterUnlock) {
      setOpenNewAfterUnlock(false);
      setShowNewSecret(true);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <h1 className={styles.heading}>My Secrets</h1>
          {isAuthenticated && (phase === 'locked' || phase === 'unlocked') && (
            <span className={styles.lockBadge}>{isUnlocked ? 'Unlocked' : 'Locked'}</span>
          )}
          {isAuthenticated && (phase === 'locked' || phase === 'unlocked') && (
            <div className={styles.searchWrap}>
              <Search size={16} className={styles.searchIcon} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search secrets..."
                aria-label="Search secrets"
                className={`${styles.searchInput}${search ? ` ${styles.searchInputWithClear}` : ''}`}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                  className="text-muted-foreground absolute inset-y-0 right-0 hover:bg-transparent"
                >
                  <CircleXIcon />
                  <span className="sr-only">Clear input</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {isAuthenticated && (phase === 'locked' || phase === 'unlocked') && (
          <div className="flex gap-1">
            {isUnlocked ? (
              <Button variant="ghost" size="lg" onClick={lock} className={styles.button}>
                <Lock size={18} />
                Lock
              </Button>
            ) : (
              <Button variant="ghost" size="lg" onClick={() => setShowPassphrase(true)} className={styles.button}>
                <LockOpen size={18} />
                Unlock
              </Button>
            )}
            <Link href="/secrets/archive">
              <Button variant="ghost" size="lg" className={styles.button}>
                <Archive size={18} />
                Archive
              </Button>
            </Link>
            <Button variant="default" size="lg" onClick={handleNewSecret} className={styles.button}>
              <Plus size={18} />
              New Secret
            </Button>
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
      ) : notes.length === 0 ? (
        search ? (
          <EmptyResults onClear={() => setSearch('')} />
        ) : (
          <EmptyState onNewNote={handleNewSecret} />
        )
      ) : (
        <SecretsGrid
          notes={notes}
          onLoadMore={() => fetchNextPage()}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
          showArchivedBadge={!!search}
          isDragDisabled={!!search}
        />
      )}

      {showPassphrase && (
        <PassphraseModal
          onSuccess={handleUnlockSuccess}
          onClose={() => {
            setShowPassphrase(false);
            setOpenNewAfterUnlock(false);
          }}
        />
      )}

      {showNewSecret && <NewSecretModal onClose={() => setShowNewSecret(false)} />}
    </div>
  );
}
