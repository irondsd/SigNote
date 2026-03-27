'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, Lock, LockOpen, SquarePlus } from 'lucide-react';
import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { NewSecretModal } from '@/components/NewSecretModal/NewSecretModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import s from './page.module.scss';

function SecretsPageContent() {
  const { data: session, status } = useSession();
  const { phase, lockType, lock, rehydrate } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [rehydrating, setRehydrating] = useState(false);
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSecrets({
    archived: search ? undefined : false,
    search,
  });
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showNewSecret, setShowNewSecret] = useState(false);
  const [openNewAfterUnlock, setOpenNewAfterUnlock] = useState(false);
  const [pendingContent, setPendingContent] = useState<{ title: string; content: string } | null>(null);
  const { draftRestore, setDraftRestore } = useDraftRestore();

  useEffect(() => {
    if (draftRestore) {
      setPendingContent(draftRestore);
      setDraftRestore(null);
      setShowNewSecret(true);
    }
  }, [draftRestore, setDraftRestore]);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  const handleUnlock = async () => {
    if (lockType === 'soft') {
      setRehydrating(true);
      try {
        await rehydrate();
      } catch {
        setShowPassphrase(true);
      } finally {
        setRehydrating(false);
      }
    } else {
      setShowPassphrase(true);
    }
  };

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
                <Button
                  variant="secondary"
                  onClick={handleUnlock}
                  disabled={rehydrating}
                  aria-label="Unlock"
                  title="Unlock"
                >
                  <LockOpen size={18} />
                  <span className={s.lockLabel}>{rehydrating ? 'Unlocking…' : 'Unlock'}</span>
                </Button>
              )}
              <Button variant="default" onClick={handleNewSecret}>
                <SquarePlus size={18} />
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
        <EncryptionSetup address={session?.user?.address} />
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
          address={session?.user?.address}
        />
      )}

      {showNewSecret && (
        <NewSecretModal
          onClose={() => {
            setShowNewSecret(false);
            setPendingContent(null);
          }}
          initialContent={pendingContent ?? undefined}
          onSaveError={(vars) => {
            setPendingContent(vars);
            setShowNewSecret(true);
          }}
        />
      )}
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
