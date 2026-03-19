'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Archive, Search, CircleXIcon } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyResults } from '@/components/EmptyResults/EmptyResults';
import styles from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Input } from '@/components/ui/input';

export default function Page() {
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
      setShowNewNote(true);
      window.history.replaceState({}, '', '/');
    }
  }, [searchParams]);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <h1 className={styles.heading}>Notes</h1>
          {isAuthenticated && (
            <div className={styles.searchWrap}>
              <Search size={16} className={styles.searchIcon} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notes..."
                aria-label="Search notes"
                className={`${styles.searchInput}${search ? ` ${styles.searchInputWithClear}` : ''}`}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                  className="text-muted-foreground absolute inset-y-0 right-0 hover:bg-transparent"
                >
                  <CircleXIcon />
                  <span className="sr-only">Clear input</span>
                </Button>
              )}
            </div>
          )}
        </div>
        {isAuthenticated && (
          <div className="flex gap-1">
            <Link href="/archive">
              <Button variant="ghost" size="lg" className={styles.button}>
                <Archive size={18} />
                Archive
              </Button>
            </Link>
            <Button
              data-testid="new-note-btn"
              variant="default"
              size="lg"
              onClick={() => setShowNewNote(true)}
              className={styles.button}
            >
              <Plus size={18} />
              New Note
            </Button>
          </div>
        )}
      </div>

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

      {showNewNote && (
        <NewNoteModal onClose={() => setShowNewNote(false)} />
      )}
    </div>
  );
}
