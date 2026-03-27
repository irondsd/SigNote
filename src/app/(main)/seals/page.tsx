'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, Lock, LockOpen, SquarePlus } from 'lucide-react';
import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { NewSealModal } from '@/components/NewSealModal/NewSealModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import s from './page.module.scss';

function SealsPageContent() {
  const { data: session, status } = useSession();
  const { phase, lockType, lock, rehydrate } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [rehydrating, setRehydrating] = useState(false);
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSeals({
    archived: search ? undefined : false,
    search,
  });
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showNewSeal, setShowNewSeal] = useState(false);
  const [openNewAfterUnlock, setOpenNewAfterUnlock] = useState(false);
  const [pendingContent, setPendingContent] = useState<{ title: string; content: string } | null>(null);
  const { draftRestore, setDraftRestore } = useDraftRestore();

  useEffect(() => {
    if (draftRestore) {
      setPendingContent(draftRestore);
      setDraftRestore(null);
      setShowNewSeal(true);
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
              <Button variant="default" onClick={handleNewSeal}>
                <SquarePlus size={18} />
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

      {showNewSeal && (
        <NewSealModal
          onClose={() => {
            setShowNewSeal(false);
            setPendingContent(null);
          }}
          initialContent={pendingContent ?? undefined}
          onSaveError={(vars) => {
            setPendingContent(vars);
            setShowNewSeal(true);
          }}
        />
      )}
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
