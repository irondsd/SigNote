'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Archive } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import styles from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Page() {
  const { data: session, status } = useSession();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: false,
  });
  const [showNewNote, setShowNewNote] = useState(false);

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.heading}>My Notes</h1>
        {isAuthenticated && (
          <div className="flex gap-1">
            <Link href="/archive">
              <Button variant="outline" size="lg" className={styles.button}>
                <Archive size={18} />
                Archive
              </Button>
            </Link>
            <Button variant="default" size="lg" onClick={() => setShowNewNote(true)} className={styles.button}>
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
        <NotesGrid
          notes={notes}
          onNewNote={() => setShowNewNote(true)}
          onLoadMore={() => fetchNextPage()}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
        />
      ) : (
        <UnauthenticatedState />
      )}

      {showNewNote && <NewNoteModal onClose={() => setShowNewNote(false)} />}
    </div>
  );
}
