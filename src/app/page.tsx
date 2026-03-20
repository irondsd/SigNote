'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Archive } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import styles from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';

function NotesPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: search ? undefined : false,
    search,
  });
  const [showNewNote, setShowNewNote] = useState(false);

  useEffect(() => {
    if (searchParams.has('draft')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to router.push URL change is intentional, not cascading
      setShowNewNote(true);
      window.history.replaceState({}, '', '/');
    }
  }, [searchParams]);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notes"
        search={search}
        onSearchChange={setSearch}
        placeholder="Search notes"
        showSearch={isAuthenticated}
        actions={
          isAuthenticated ? (
            <>
              <Link href="/archive">
                <Button variant="ghost" size="icon" aria-label="Archive" title="Archive">
                  <Archive size={18} />
                </Button>
              </Link>
              <Button data-testid="new-note-btn" variant="default" onClick={() => setShowNewNote(true)}>
                <Plus size={18} />
                New Note
              </Button>
            </>
          ) : undefined
        }
      />

      {showLoadingState ? (
        <div className={styles.loading}>
          <span className={styles.spinner} />
        </div>
      ) : isAuthenticated ? (
        notes.length === 0 ? (
          search ? (
            <EmptyResults onClear={() => setSearch('')} />
          ) : (
            <EmptyState onNewNote={() => setShowNewNote(true)} />
          )
        ) : (
          <NotesGrid
            notes={notes}
            onLoadMore={() => fetchNextPage()}
            hasMore={hasNextPage ?? false}
            isLoadingMore={isFetchingNextPage}
            showArchivedBadge={!!search}
            isDragDisabled={!!search}
          />
        )
      ) : (
        <UnauthenticatedState />
      )}

      {showNewNote && <NewNoteModal onClose={() => setShowNewNote(false)} />}
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
