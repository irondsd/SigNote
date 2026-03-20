'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Archive, Lock, LockOpen } from 'lucide-react';
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
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import s from './page.module.scss';

function SecretsPageContent() {
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
    <div className={s.page}>
      <PageHeader
        title="Secrets"
        search={search}
        onSearchChange={setSearch}
        placeholder="Search secrets"
        showSearch={isAuthenticated && (phase === 'locked' || phase === 'unlocked')}
        actions={
          isAuthenticated && (phase === 'locked' || phase === 'unlocked') ? (
            <>
              <Link href="/secrets/archive">
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
              <Button variant="default" onClick={handleNewSecret}>
                <Plus size={18} />
                New Secret
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

export default function SecretsPage() {
  return (
    <Suspense>
      <SecretsPageContent />
    </Suspense>
  );
}
