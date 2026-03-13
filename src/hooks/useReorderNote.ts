'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CachedNote } from './useNoteMutations';

type ReorderInput = {
  id: string;
  position: number;
  oldIndex: number;
  newIndex: number;
};

async function apiReorderNote({ id, position }: ReorderInput) {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position }),
  });
  if (!res.ok) throw new Error('Failed to reorder note');
  return res.json();
}

export const useReorderNote = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: apiReorderNote,
    onMutate: async ({ id, position, newIndex }) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedNote[]>>({ queryKey: ['notes'] });

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;

        const allNotes = data.pages.flat();
        const noteIndex = allNotes.findIndex((n) => n._id === id);
        if (noteIndex === -1) return;

        const [movedNote] = allNotes.splice(noteIndex, 1);
        const updatedNote = { ...movedNote, position };

        allNotes.splice(newIndex, 0, updatedNote);

        // Re-chunk into original page sizes
        const newPages: CachedNote[][] = [];
        let offset = 0;
        for (const page of data.pages) {
          newPages.push(allNotes.slice(offset, offset + page.length));
          offset += page.length;
        }

        qc.setQueryData(queryKey, { ...data, pages: newPages });
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to reorder note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};
