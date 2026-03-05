'use client';

import { useSession } from 'next-auth/react';
import { Notebook, Search } from 'lucide-react';
import { useState } from 'react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import styles from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Input } from '@/components/ui/input';

export default function Page() {
  const { data: session, status } = useSession();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: true,
    search,
  });

  const isAuthenticated = !!session?.user?.address;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <h1 className={styles.heading}>My Archived Notes</h1>
          {isAuthenticated && (
            <div className={styles.searchWrap}>
              <Search size={16} className={styles.searchIcon} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search archived notes..."
                aria-label="Search archived notes"
                className={styles.searchInput}
              />
            </div>
          )}
        </div>
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
