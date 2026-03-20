'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Archive, Lock, LockOpen } from 'lucide-react';
import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { NewSealModal } from '@/components/NewSealModal/NewSealModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import s from './page.module.scss';

function SealsPageContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const { phase, lock } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSeals({
    archived: search ? undefined : false,
    search,
  });
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showNewSeal, setShowNewSeal] = useState(false);
  const [openNewAfterUnlock, setOpenNewAfterUnlock] = useState(false);

  useEffect(() => {
    if (searchParams.has('draft')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to router.push URL change is intentional, not cascading
      setShowNewSeal(true);
      window.history.replaceState({}, '', '/seals');
    }
  }, [searchParams]);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

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
    <div className={s.page}>
      <PageHeader
        title="Seals"
        search={search}
        onSearchChange={setSearch}
        placeholder="Search seals"
        showSearch={isAuthenticated && (phase === 'locked' || phase === 'unlocked')}
        actions={
          isAuthenticated && (phase === 'locked' || phase === 'unlocked') ? (
            <>
              <Link href="/seals/archive">
                <Button variant="ghost" size="icon" aria-label="Archive" title="Archive">
                  <Archive size={18} />
                </Button>
              </Link>
              {isUnlocked ? (
                <Button variant="secondary" onClick={lock} aria-label="Lock" title="Lock">
                  <Lock size={18} />
                  <span className={s.lockLabel}>Lock</span>
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setShowPassphrase(true)} aria-label="Unlock" title="Unlock">
                  <LockOpen size={18} />
                  <span className={s.lockLabel}>Unlock</span>
                </Button>
              )}
              <Button variant="default" onClick={handleNewSeal}>
                <Plus size={18} />
                New Seal
              </Button>
            </>
          ) : undefined
        }
      />

      {showLoadingState ? (
        <div className={s.loading}>
          <span className={s.spinner} />
        </div>
      ) : !isAuthenticated ? (
        <UnauthenticatedState />
      ) : phase === 'setup' ? (
        <EncryptionSetup />
      ) : notes.length === 0 ? (
        search ? (
          <EmptyResults onClear={() => setSearch('')} />
        ) : (
          <EmptyState onNewNote={handleNewSeal} />
        )
      ) : (
        <SealsGrid
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

      {showNewSeal && <NewSealModal onClose={() => setShowNewSeal(false)} />}
    </div>
  );
}

export default function SealsPage() {
  return (
    <Suspense>
      <SealsPageContent />
    </Suspense>
  );
}
