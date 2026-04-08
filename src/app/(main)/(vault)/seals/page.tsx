'use client';

import { Suspense, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, SquarePlus } from 'lucide-react';
import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { NewSealModal } from '@/components/NewSealModal/NewSealModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import s from './page.module.scss';

function SealsPageContent() {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSeals({
    archived: search ? undefined : false,
    search,
  });
  const [showNewSeal, setShowNewSeal] = useState(false);
  const [saveErrorContent, setSaveErrorContent] = useState<{ title: string; content: string } | null>(null);
  const { draftRestore, setDraftRestore } = useDraftRestore();
  const { execute, PassphraseGuard } = useSimpleEncryptionGuard();

  const modalOpen = showNewSeal || !!draftRestore || !!saveErrorContent;
  const initialContent = draftRestore ?? saveErrorContent ?? undefined;

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  const handleNewSeal = () => execute(async () => setShowNewSeal(true));

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
              <Link href="/seals/archive" className="mr-2">
                <Button variant="ghost" size="icon" aria-label="Archive" title="Archive">
                  <Archive size={18} />
                </Button>
              </Link>
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

      {PassphraseGuard}

      {modalOpen && (
        <NewSealModal
          onClose={() => {
            setShowNewSeal(false);
            setDraftRestore(null);
            setSaveErrorContent(null);
          }}
          initialContent={initialContent}
          onSaveError={(vars) => {
            setSaveErrorContent(vars);
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
