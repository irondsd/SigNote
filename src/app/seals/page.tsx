'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Archive, Lock, LockOpen, Search, CircleXIcon } from 'lucide-react';
import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { NewSealModal } from '@/components/NewSealModal/NewSealModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import styles from './page.module.scss';

export default function SealsPage() {
  const { data: session, status } = useSession();
  const { profileStatus, isUnlocked, lock } = useEncryption();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSeals({
    archived: search ? undefined : false,
    search,
  });
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showNewSeal, setShowNewSeal] = useState(false);
  const [openNewAfterUnlock, setOpenNewAfterUnlock] = useState(false);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState =
    isLoading || status === 'loading' || (status === 'authenticated' && profileStatus === 'loading');

  const handleNewSeal = () => {
    if (!isUnlocked) {
      setOpenNewAfterUnlock(true);
      setShowPassphrase(true);
      return;
    }
    setShowNewSeal(true);
  };

  const handleUnlockSuccess = () => {
    setShowPassphrase(false);
    if (openNewAfterUnlock) {
      setOpenNewAfterUnlock(false);
      setShowNewSeal(true);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <h1 className={styles.heading}>My Seals</h1>
          {isAuthenticated && profileStatus === 'exists' && (
            <span className={styles.lockBadge}>{isUnlocked ? 'Unlocked' : 'Locked'}</span>
          )}
          {isAuthenticated && profileStatus === 'exists' && (
            <div className={styles.searchWrap}>
              <Search size={16} className={styles.searchIcon} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search seals..."
                aria-label="Search seals"
                className={`${styles.searchInput}${search ? ` ${styles.searchInputWithClear}` : ''}`}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                  className="text-muted-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 rounded-l-none hover:bg-transparent"
                >
                  <CircleXIcon />
                  <span className="sr-only">Clear input</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {isAuthenticated && profileStatus === 'exists' && (
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
            <Link href="/seals/archive">
              <Button variant="ghost" size="lg" className={styles.button}>
                <Archive size={18} />
                Archive
              </Button>
            </Link>
            <Button variant="default" size="lg" onClick={handleNewSeal} className={styles.button}>
              <Plus size={18} />
              New Seal
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
      ) : profileStatus === 'missing' ? (
        <EncryptionSetup />
      ) : (
        <SealsGrid
          notes={notes}
          onNewNote={handleNewSeal}
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

      {showNewSeal && <NewSealModal onClose={() => setShowNewSeal(false)} />}
    </div>
  );
}
