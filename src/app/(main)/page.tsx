'use client';

import { Suspense, useState } from 'react';
import { useSession } from 'next-auth/react';
import { SquarePlus, Archive } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import s from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader/PageHeader';

function NotesPage() {
  const { data: session, status } = useSession();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: search ? undefined : false,
    search,
  });
  const [showNewNote, setShowNewNote] = useState(false);
  const [saveErrorContent, setSaveErrorContent] = useState<{ title: string; content: string } | null>(null);
  const { draftRestore, setDraftRestore } = useDraftRestore();

  const modalOpen = showNewNote || !!draftRestore || !!saveErrorContent;
  const initialContent = draftRestore ?? saveErrorContent ?? undefined;

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={s.page}>
      <PageHeader
        title="Notes"
        search={search}
        onSearchChange={setSearch}
        placeholder="Search notes"
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

      {modalOpen && (
        <NewNoteModal
          onClose={() => {
            setShowNewNote(false);
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

export default function Page() {
  return (
    <Suspense>
      <NotesPage />
    </Suspense>
  );
}
