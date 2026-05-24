'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import { api } from '@/lib/api';
import { cancelAndSnapshot, insertAtTop, restoreSnapshots, invalidateSnapshots } from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';
import { useDeleteTier, useUndeleteTier, useUpdateTier } from './internal/useTierMutations';

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
  pattern: string | null;
  pinned: boolean;
  expiresAt: string | null;
  burnAfterReading: boolean;
};

type CreateNoteInput = { title: string; content: string; color?: string | null; pattern?: string | null };
type UpdateNoteInput = {
  id: string;
  title?: string;
  content?: string;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
  pattern?: string | null;
  pinned?: boolean;
  expiresAt?: string | null;
  burnAfterReading?: boolean;
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
        pattern: input.pattern ?? null,
        pinned: false,
        expiresAt: null,
        burnAfterReading: false,
      };
      insertAtTop(qc, snapshots, tempNote);
      return { snapshots, tempId };
    },
    onSuccess: (data, _vars, context) => {
      const realId = (data as { _id: string })?._id;
      if (realId && context?.tempId) registerStableKey(realId, context.tempId);
      posthog.capture('note_created');
    },
    onError: (_err, vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      posthog.capture('mutation_failed', { tier: 'note', operation: 'create' });
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

export const useDeleteNote = () => useDeleteTier<CachedNote>(ROOT, apiDeleteNote, 'note');
export const useUndeleteNote = () => useUndeleteTier<CachedNote>(ROOT, apiUndeleteNote, 'note');
export const useUpdateNote = () => useUpdateTier<CachedNote>(ROOT, apiUpdateNote, 'note', 'content');
