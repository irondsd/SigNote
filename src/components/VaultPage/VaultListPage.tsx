'use client';

import { Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, SquarePlus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { EmptyState, type EmptyStateNoun } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { decryptDraftContent } from '@/lib/crypto';
import { clearDraft, plaintextOf, type DraftContent } from '@/lib/draft';
import s from './VaultPage.module.scss';

type InitialContent = DraftContent;

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
};

export type VaultListPageConfig<T> = {
  title: string;
  /** Singular noun for the empty state — "No secrets yet" rather than the shared default. */
  emptyNoun: EmptyStateNoun;
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
  emptyNoun,
  archiveHref,
  newLabel,
  useItems,
  Grid,
  NewModal,
  showSetupDisplayName,
}: VaultListPageConfig<T>) {
  const { data: session, status } = useSession();
  const { mek, phase, lockType, rehydrate: ctxRehydrate } = useEncryption();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useItems({ archived: false });
  const [showNew, setShowNew] = useState(false);
  const { draftRestore, setDraftRestore } = useDraftRestore();
  const { execute, PassphraseGuard } = useSimpleEncryptionGuard();

  // A restored draft is ciphertext, so opening its editor needs the MEK. This
  // path used to open the modal whether or not the vault was unlocked; it now
  // asks the same way every other guarded action does — which after a soft lock
  // means not asking at all, because the device share rebuilds the MEK on its
  // own. Only a hard lock reaches the passphrase, for content that would have
  // needed it anyway.
  const [restored, setRestored] = useState<DraftContent | null>(null);
  const promptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!draftRestore) {
      setRestored(null);
      promptedFor.current = null;
      return;
    }
    const plain = plaintextOf(draftRestore);
    if (plain) {
      setRestored(plain);
      return;
    }

    let live = true;
    const open = async (key: CryptoKey) => {
      try {
        const content = await decryptDraftContent(key, draftRestore.enc!);
        if (live) setRestored({ ...draftRestore, content });
      } catch {
        // A draft that will not open belongs to another account, or to an
        // encryption profile that has since been reset. Neither is
        // recoverable, and leaving it would re-offer it on every visit.
        clearDraft(draftRestore.draftId);
        toast.error('That draft could not be recovered.');
        setDraftRestore(null);
      }
    };

    if (mek) {
      void open(mek);
    } else if (promptedFor.current !== (draftRestore.draftId ?? null)) {
      promptedFor.current = draftRestore.draftId ?? null;
      // Rehydration lands as a new `mek`, which re-runs this effect.
      if (lockType === 'soft') void ctxRehydrate().catch(() => execute(open));
      else void execute(open);
    }
    return () => {
      live = false;
    };
    // `execute` changes identity with the MEK; re-running on that alone would ask twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRestore, lockType, mek]);

  const modalOpen = showNew || !!restored;
  const initialContent = restored ?? undefined;

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
        <EmptyState onNewNote={handleNew} noun={emptyNoun} />
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
          }}
          key={initialContent?.draftId ?? 'new'}
          initialContent={initialContent}
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
