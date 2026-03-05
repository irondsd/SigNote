'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Notebook } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import styles from './page.module.scss';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';

export default function Page() {
  const { data: session, status } = useSession();
  const { data: notes, isLoading, isPending } = useNotes({ archived: true });
  const [showNewNote, setShowNewNote] = useState(false);

  const isAuthenticated = !!session?.user?.address;

  const showLoadingState = isLoading || isPending || status === 'loading';

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
        <NotesGrid notes={notes ?? []} onNewNote={() => setShowNewNote(true)} archive />
      ) : (
        <UnauthenticatedState />
      )}
    </div>
  );
}
