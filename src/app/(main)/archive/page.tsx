'use client';

import { useSession } from 'next-auth/react';
import { NotebookText } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { ArchivePageHeader } from '@/components/ArchivePageHeader/ArchivePageHeader';
import s from './page.module.scss';

export default function Page() {
  const { data: session, status } = useSession();
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotes({
    archived: true,
  });

  const isAuthenticated = !!session?.user?.id;
  const notes = data?.pages.flatMap((page) => page) ?? [];
  const showLoadingState = isLoading || status === 'loading';

  return (
    <div className={s.page}>
      <ArchivePageHeader title="Archived Notes" backHref="/" backLabel="Notes" BackIcon={NotebookText} />

      {showLoadingState ? (
        <div className={s.loading}>
          <span className={s.spinner} />
        </div>
      ) : isAuthenticated ? (
        notes.length === 0 ? (
          <EmptyStateArchive />
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
    </div>
  );
}
