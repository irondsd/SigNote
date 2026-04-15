'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  cancelAndSnapshot,
  insertAtTop,
  filterOut,
  patchInPlace,
  toggleArchive,
  restoreSnapshots,
  invalidateSnapshots,
} from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';

export type CachedNote = {
  _id: string;
  title: string;
  content: string;
  archived: boolean;
  deletedAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  color: string | null;
};

type CreateNoteInput = { title: string; content: string; color?: string | null };
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
  return api.post('/api/notes', { json: input }).json();
}

async function apiDeleteNote(id: string) {
  return api.delete(`/api/notes/${id}`).json();
}

async function apiUndeleteNote({ id }: { id: string; note: CachedNote }) {
  return api.patch(`/api/notes/${id}`, { json: { deleted: false } }).json();
}

async function apiUpdateNote({ id, ...data }: UpdateNoteInput) {
  return api.patch(`/api/notes/${id}`, { json: data }).json();
}

export const useCreateNote = (callbacks?: { onError?: (vars: CreateNoteInput) => void }) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateNote,
    onMutate: async (input) => {
      const snapshots = await cancelAndSnapshot<CachedNote>(qc, ROOT);
      const tempId = `temp-${Date.now()}`;
      const tempNote: CachedNote = {
        _id: tempId,
        title: input.title,
        content: input.content,
        archived: false,
        deletedAt: null,
        position: -1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        color: input.color ?? null,
      };
      insertAtTop(qc, snapshots, tempNote);
      return { snapshots, tempId };
    },
    onSuccess: (data, _vars, context) => {
      const realId = (data as { _id: string })?._id;
      if (realId && context?.tempId) registerStableKey(realId, context.tempId);
    },
    onError: (_err, vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to create note', {
        description: 'Your content has been recovered.',
        duration: Infinity,
      });
      callbacks?.onError?.(vars);
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context?.snapshots?.length) return invalidateSnapshots(qc, context.snapshots);
      return qc.invalidateQueries({ queryKey: [ROOT] });
    },
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
    onSettled: (_data, _err, _vars, context) => {
      if (context?.snapshots?.length) return invalidateSnapshots(qc, context.snapshots);
      return qc.invalidateQueries({ queryKey: [ROOT] });
    },
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
    onSettled: (_data, _err, _vars, context) => {
      if (context?.snapshots?.length) return invalidateSnapshots(qc, context.snapshots);
      return qc.invalidateQueries({ queryKey: [ROOT] });
    },
  });
};

export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateNote,
    onMutate: async ({ id, archived, ...rest }) => {
      const snapshots = await cancelAndSnapshot<CachedNote>(qc, ROOT);
      const patch = { ...rest, updatedAt: new Date().toISOString() } as Partial<CachedNote>;
      if (archived !== undefined) {
        toggleArchive(qc, snapshots, id, archived, patch);
      } else {
        patchInPlace(qc, snapshots, id, patch);
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to save note');
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context?.snapshots?.length) return invalidateSnapshots(qc, context.snapshots);
      return qc.invalidateQueries({ queryKey: [ROOT] });
    },
  });
};
