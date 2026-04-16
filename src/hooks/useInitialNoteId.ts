'use client';

import { useEffect, useRef, useState } from 'react';

export function useInitialNoteId<T>(
  notes: T[] | undefined,
  getId: (note: T) => string,
  onOpen: (note: T) => void,
  ready = true,
) {
  const [initialNoteId, setInitialNoteId] = useState<string | null>(null);
  const openedInitialRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialNoteId(new URLSearchParams(window.location.search).get('id'));
  }, []);

  useEffect(() => {
    if (!ready || !initialNoteId || openedInitialRef.current || !notes) return;
    const note = notes.find((n) => getId(n) === initialNoteId);
    if (!note) return;
    openedInitialRef.current = true;
    onOpen(note);
  }, [notes, initialNoteId, getId, onOpen, ready]);
}
