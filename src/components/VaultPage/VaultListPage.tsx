'use client';

import { Suspense, useState, type ComponentType } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, SquarePlus } from 'lucide-react';
import Link from 'next/link';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import s from './VaultPage.module.scss';

type InitialContent = { title: string; content: string };

type ListQuery<T> = {
  data?: { pages: T[][] };
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  fetchNextPage: () => unknown;
};

type GridProps<T> = {
  notes: T[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
};

type NewModalProps = {
  onClose: () => void;
  initialContent?: InitialContent;
  onSaveError?: (vars: InitialContent) => void;
};

export type VaultListPageConfig<T> = {
  title: string;
  archiveHref: string;
  newLabel: string;
  useItems: (params: { archived?: boolean }) => ListQuery<T>;
  Grid: ComponentType<GridProps<T>>;
  NewModal: ComponentType<NewModalProps>;
  /** Secrets greet the user by name on the setup screen; seals don't. */
  showSetupDisplayName?: boolean;
};

function VaultListPageContent<T>({
  title,
  archiveHref,
  newLabel,
  useItems,
  Grid,
  NewModal,
  showSetupDisplayName,
}: VaultListPageConfig<T>) {
  const { data: session, status } = useSession();
  const { phase } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useItems({ archived: false });
  const [showNew, setShowNew] = useState(false);
  const [saveErrorContent, setSaveErrorContent] = useState<InitialContent | null>(null);
  const { draftRestore, setDraftRestore } = useDraftRestore();
  const { execute, PassphraseGuard } = useSimpleEncryptionGuard();

  const modalOpen = showNew || !!draftRestore || !!saveErrorContent;
  const initialContent = draftRestore ?? saveErrorContent ?? undefined;

  const isAuthenticated = !!session?.user?.id;
  const unlockedOrLocked = phase === 'locked' || phase === 'unlocked';
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading' || (status === 'authenticated' && phase === 'loading');

  const handleNew = () => execute(async () => setShowNew(true));

  return (
    <div className={s.page}>
      <PageHeader
        title={title}
        showSearch={isAuthenticated && unlockedOrLocked}
        actions={
          isAuthenticated && unlockedOrLocked ? (
            <>
              <Link href={archiveHref} className="mr-2">
                <Button variant="ghost" size="icon" aria-label="Archive" title="Archive">
                  <Archive size={18} />
                </Button>
              </Link>
              <Button variant="default" onClick={handleNew}>
                <SquarePlus size={18} />
                {newLabel}
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
        <EncryptionSetup displayName={showSetupDisplayName ? (session?.user?.name ?? undefined) : undefined} />
      ) : notes.length === 0 ? (
        <EmptyState onNewNote={handleNew} />
      ) : (
        <Grid
          notes={notes}
          onLoadMore={() => fetchNextPage()}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
        />
      )}

      {PassphraseGuard}

      {modalOpen && (
        <NewModal
          onClose={() => {
            setShowNew(false);
            setDraftRestore(null);
            setSaveErrorContent(null);
          }}
          initialContent={initialContent}
          onSaveError={(vars) => setSaveErrorContent(vars)}
        />
      )}
    </div>
  );
}

/** Shared list page for the encrypted tiers (secrets, seals). */
export function VaultListPage<T>(config: VaultListPageConfig<T>) {
  return (
    <Suspense>
      <VaultListPageContent {...config} />
    </Suspense>
  );
}
