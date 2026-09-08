'use client';

import { Suspense, useState } from 'react';
import { useSession } from 'next-auth/react';
import { SquarePlus, Archive } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { plaintextOf } from '@/lib/draft';
import s from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AuthErrorToast } from '@/components/AuthErrorToast/AuthErrorToast';

function NotesPage() {
  const { data: session, status } = useSession();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: false,
  });
  const [showNewNote, setShowNewNote] = useState(false);
  const { draftRestore, setDraftRestore } = useDraftRestore();

  // Note drafts are stored in the clear, so there is nothing to decrypt here —
  // `plaintextOf` only ever returns null for the encrypted tiers, which never
  // route to this page.
  const initialContent = (draftRestore && plaintextOf(draftRestore)) ?? undefined;
  const modalOpen = showNewNote || !!initialContent;

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={s.page}>
      <AuthErrorToast />
      <PageHeader
        title="Notes"
        showSearch={isAuthenticated}
        actions={
          isAuthenticated ? (
            <>
              <Link href="/archive" className="mr-2">
                <Button variant="ghost" size="icon" aria-label="Archive" title="Archive">
                  <Archive size={18} />
                </Button>
              </Link>
              <Button data-testid="new-note-btn" variant="default" onClick={() => setShowNewNote(true)}>
                <SquarePlus size={18} />
                New Note
              </Button>
            </>
          ) : undefined
        }
      />

      {showLoadingState ? (
        <div className={s.loading}>
          <span className={s.spinner} />
        </div>
      ) : isAuthenticated ? (
        notes.length === 0 ? (
          <EmptyState onNewNote={() => setShowNewNote(true)} />
        ) : (
          <NotesGrid
            notes={notes}
            onLoadMore={() => fetchNextPage()}
            hasMore={hasNextPage ?? false}
            isLoadingMore={isFetchingNextPage}
          />
        )
      ) : (
        <UnauthenticatedState />
      )}

      {modalOpen && (
        <NewNoteModal
          onClose={() => {
            setShowNewNote(false);
            setDraftRestore(null);
          }}
          key={initialContent?.draftId ?? 'new'}
          initialContent={initialContent}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NotesPage />
    </Suspense>
  );
}
