'use client';

import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { trpcClient } from '@/lib/trpcClient';
import { dispatchCommonUpdate } from './internal/tierClient';
import { commonTempNote, useCreateTier, useDeleteTier, useUndeleteTier, useUpdateTier } from './internal/useTierMutations';

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

export const useCreateNote = (callbacks?: { onError?: (vars: CreateNoteInput) => void }) =>
  useCreateTier<CachedNote, CreateNoteInput>(
    ROOT,
    apiCreateNote,
    (input, tempId) => ({ ...commonTempNote(input, tempId), content: input.content }),
    callbacks,
  );

export const useDeleteNote = () => useDeleteTier<CachedNote>(ROOT, apiDeleteNote);
export const useUndeleteNote = () => useUndeleteTier<CachedNote>(ROOT, apiUndeleteNote);
export const useUpdateNote = () => useUpdateTier<CachedNote>(ROOT, apiUpdateNote, 'content');
