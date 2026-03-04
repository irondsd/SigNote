'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Plus } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { NotesGrid } from '@/components/NotesGrid/NotesGrid';
import { NewNoteModal } from '@/components/NewNoteModal/NewNoteModal';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import styles from './page.module.scss';

export default function Page() {
  const { data: session, status } = useSession();
  const { data: notes, isLoading, isPending } = useNotes();
  const [showNewNote, setShowNewNote] = useState(false);

  const isAuthenticated = !!session?.user?.address;

  const showLoadingState = isLoading || isPending || status === 'loading';

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.heading}>My Notes</h1>
        {isAuthenticated && (
          <button className={styles.newBtn} onClick={() => setShowNewNote(true)}>
            <Plus size={18} />
            New Note
          </button>
        )}
      </div>

      {showLoadingState ? (
        <div className={styles.loading}>
          <span className={styles.spinner} />
        </div>
      ) : isAuthenticated ? (
        <NotesGrid notes={notes ?? []} onNewNote={() => setShowNewNote(true)} />
      ) : (
        <UnauthenticatedState />
      )}

      {showNewNote && <NewNoteModal onClose={() => setShowNewNote(false)} />}
    </div>
  );
}
