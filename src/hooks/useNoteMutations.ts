'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { trpcClient } from '@/lib/trpcClient';
import { cancelAndSnapshot, insertAtTop, restoreSnapshots, invalidateSnapshots } from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';
import { dispatchCommonUpdate } from './internal/tierClient';
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
  tags: string[];
};

type CreateNoteInput = {
  title: string;
  content: string;
  color?: string | null;
  pattern?: string | null;
  tags?: string[];
};
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
  tags?: string[];
};

const ROOT = 'notes';

async function apiCreateNote(input: CreateNoteInput): Promise<CachedNote> {
  return (await trpcClient.notes.create.mutate({
    ...input,
    color: input.color as NoteColor | null | undefined,
    pattern: input.pattern as NotePattern | null | undefined,
  })) as unknown as CachedNote;
}

async function apiDeleteNote(id: string) {
  return trpcClient.notes.delete.mutate({ id });
}

async function apiUndeleteNote({ id }: { id: string; note: CachedNote }) {
  return trpcClient.notes.restore.mutate({ id });
}

async function apiUpdateNote({ id, ...data }: UpdateNoteInput) {
  // Route metadata changes to their discrete procedures; fall through to the
  // content update (title/content) when none matched.
  const handled = dispatchCommonUpdate('notes', id, data);
  if (handled) return handled;
  return (await trpcClient.notes.update.mutate({
    id,
    title: data.title,
    content: data.content,
  })) as unknown as CachedNote;
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
        tags: input.tags ?? [],
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
