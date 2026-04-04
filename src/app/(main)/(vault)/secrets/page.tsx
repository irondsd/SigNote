'use client';

import { Suspense, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, SquarePlus } from 'lucide-react';
import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { NewSecretModal } from '@/components/NewSecretModal/NewSecretModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import s from './page.module.scss';

function SecretsPageContent() {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useSecrets({
    archived: search ? undefined : false,
    search,
  });
  const [showNewSecret, setShowNewSecret] = useState(false);
  const [saveErrorContent, setSaveErrorContent] = useState<{ title: string; content: string } | null>(null);
  const { draftRestore, setDraftRestore } = useDraftRestore();
  const { execute, PassphraseGuard } = useSimpleEncryptionGuard();

  const modalOpen = showNewSecret || !!draftRestore || !!saveErrorContent;
  const initialContent = draftRestore ?? saveErrorContent ?? undefined;

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  const handleNewSecret = () => execute(async () => setShowNewSecret(true));

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
        <EncryptionSetup displayName={session?.user?.name ?? undefined} />
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

      {PassphraseGuard}

      {modalOpen && (
        <NewSecretModal
          onClose={() => {
            setShowNewSecret(false);
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

export default function SecretsPage() {
  return (
    <Suspense>
      <SecretsPageContent />
    </Suspense>
  );
}
