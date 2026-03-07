'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';

type Note = {
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
type UpdateNoteInput = { id: string; title?: string; content?: string; archived?: boolean; deleted?: boolean; color?: string | null };

async function apiCreateNote(input: CreateNoteInput) {
  const res = await fetch('/api/notes/t1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

async function apiDeleteNote(id: string) {
  const res = await fetch(`/api/notes/t1/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

async function apiUndeleteNote(id: string) {
  const res = await fetch(`/api/notes/t1/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: false }),
  });
  if (!res.ok) throw new Error('Failed to undo delete');
  return res.json();
}

async function apiUpdateNote({ id, ...data }: UpdateNoteInput) {
  const res = await fetch(`/api/notes/t1/${id}`, {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteNote,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<Note[]>>({ queryKey: ['notes'] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateNote,
    onMutate: async ({ id, archived, ...rest }) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<InfiniteData<Note[]>>({ queryKey: ['notes'] });
      const isArchiveToggle = archived !== undefined;

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        const isArchivedView = queryKey[2] === 'archived';

        const updatedPages = data.pages.map((page) =>
          page
            .map((note) =>
              note._id === id
                ? { ...note, ...rest, archived: archived ?? note.archived }
                : note
            )
            .filter((note) => {
              if (note._id !== id || !isArchiveToggle) return true;
              // Keep the note only if it now belongs to this view
              return note.archived === isArchivedView;
            })
        );

        qc.setQueryData(queryKey, { ...data, pages: updatedPages });
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
