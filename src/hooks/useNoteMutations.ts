'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';

export type CachedNote = {
  _id: string;
  title: string;
  content: string;
  archived: boolean;
  deletedAt: string | null;
  address: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  color: string | null;
};

type CreateNoteInput = { title: string; content: string };
type UpdateNoteInput = {
  id: string;
  title?: string;
  content?: string;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
};

async function apiCreateNote(input: CreateNoteInput) {
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

async function apiDeleteNote(id: string) {
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

async function apiUndeleteNote({ id }: { id: string; note: CachedNote }) {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: false }),
  });
  if (!res.ok) throw new Error('Failed to undo delete');
  return res.json();
}

async function apiUpdateNote({ id, ...data }: UpdateNoteInput) {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update note');
  return res.json();
}

export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateNote,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedNote[]>>({ queryKey: ['notes'] });

      const tempNote: CachedNote = {
        _id: `temp-${Date.now()}`,
        title: input.title,
        content: input.content,
        archived: false,
        deletedAt: null,
        address: '',
        position: -1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        color: null,
      };

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        if (queryKey[2] === 'archived') return;
        const firstPage = data.pages[0] ?? [];
        qc.setQueryData(queryKey, {
          ...data,
          pages: [[tempNote, ...firstPage], ...data.pages.slice(1)],
        });
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to create note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteNote,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedNote[]>>({ queryKey: ['notes'] });
      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        qc.setQueryData(queryKey, {
          ...data,
          pages: data.pages.map((page) => page.filter((note) => note._id !== id)),
        });
      });
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to delete note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useUndeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUndeleteNote,
    onMutate: async ({ note }) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedNote[]>>({ queryKey: ['notes'] });
      const restoredNote = { ...note, deletedAt: null };

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        if (queryKey[2] === 'archived') return;
        const firstPage = data.pages[0] ?? [];
        qc.setQueryData(queryKey, {
          ...data,
          pages: [[restoredNote, ...firstPage], ...data.pages.slice(1)],
        });
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to restore note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateNote,
    onMutate: async ({ id, archived, ...rest }) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedNote[]>>({ queryKey: ['notes'] });
      const isArchiveToggle = archived !== undefined;

      // Find the note across all caches so we can move it when toggling archive
      let foundNote: CachedNote | undefined;
      if (isArchiveToggle) {
        for (const [, data] of snapshots) {
          if (!data) continue;
          for (const page of data.pages) {
            const n = page.find((note) => note._id === id);
            if (n) {
              foundNote = n;
              break;
            }
          }
          if (foundNote) break;
        }
      }

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        const isArchivedView = queryKey[2] === 'archived';

        if (isArchiveToggle && foundNote) {
          const noteNowBelongsHere = (archived === true) === isArchivedView;
          if (noteNowBelongsHere) {
            // Add to the destination view's first page (avoid duplicates)
            const updatedNote = { ...foundNote, ...rest, archived: archived! };
            const firstPage = data.pages[0] ?? [];
            qc.setQueryData(queryKey, {
              ...data,
              pages: [[updatedNote, ...firstPage.filter((n) => n._id !== id)], ...data.pages.slice(1)],
            });
          } else {
            // Remove from the source view
            qc.setQueryData(queryKey, {
              ...data,
              pages: data.pages.map((page) => page.filter((note) => note._id !== id)),
            });
          }
        } else {
          // Plain update in place
          qc.setQueryData(queryKey, {
            ...data,
            pages: data.pages.map((page) =>
              page.map((note) => (note._id === id ? { ...note, ...rest, archived: archived ?? note.archived } : note)),
            ),
          });
        }
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to save note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};
