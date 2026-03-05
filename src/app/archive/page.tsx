'use client';

import { useSession } from 'next-auth/react';
import { Notebook } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import styles from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Page() {
  const { data: session, status } = useSession();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: true,
  });

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.heading}>My Archived Notes</h1>
        {isAuthenticated && (
          <div className="flex gap-1">
            <Link href="/">
              <Button variant="outline" size="lg">
                <Notebook size={18} />
                Notes
              </Button>
            </Link>
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
          onLoadMore={() => fetchNextPage()}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
          archive
        />
      ) : (
        <UnauthenticatedState />
      )}
    </div>
  );
}
