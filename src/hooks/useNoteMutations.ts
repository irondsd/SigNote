'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  cancelAndSnapshot,
  insertAtTop,
  filterOut,
  patchInPlace,
  toggleArchive,
  restoreSnapshots,
} from '@/lib/queryCache';

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

const ROOT = 'notes';

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

export const useCreateNote = (callbacks?: { onError?: (vars: CreateNoteInput) => void }) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateNote,
    onMutate: async (input) => {
      const snapshots = await cancelAndSnapshot<CachedNote>(qc, ROOT);
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
      insertAtTop(qc, snapshots, tempNote);
      return { snapshots };
    },
    onError: (_err, vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to create note', {
        description: 'Your content has been recovered.',
        duration: Infinity,
      });
      callbacks?.onError?.(vars);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteNote,
    onMutate: async (id) => {
      const snapshots = await cancelAndSnapshot<CachedNote>(qc, ROOT);
      filterOut(qc, snapshots, id);
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to delete note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useUndeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUndeleteNote,
    onMutate: async ({ note }) => {
      const snapshots = await cancelAndSnapshot<CachedNote>(qc, ROOT);
      insertAtTop(qc, snapshots, { ...note, deletedAt: null });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to restore note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateNote,
    onMutate: async ({ id, archived, ...rest }) => {
      const snapshots = await cancelAndSnapshot<CachedNote>(qc, ROOT);
      if (archived !== undefined) {
        toggleArchive(qc, snapshots, id, archived, rest as Partial<CachedNote>);
      } else {
        patchInPlace(qc, snapshots, id, rest as Partial<CachedNote>);
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to save note');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};
