'use client';

import { type EncryptedPayload } from '@/types/crypto';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { trpcClient } from '@/lib/trpcClient';
import { dispatchCommonUpdate } from './internal/tierClient';
import { commonTempNote, useCreateTier, useDeleteTier, useUndeleteTier, useUpdateTier } from './internal/useTierMutations';

export type CachedSealNote = {
  _id: string;
  title: string;
  encryptedBody: EncryptedPayload | null;
  wrappedNoteKey: EncryptedPayload | null;
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

type CreateSealInput = {
  title: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
  tags?: string[];
};

type UpdateSealInput = {
  id: string;
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
  pinned?: boolean;
  expiresAt?: string | null;
  burnAfterReading?: boolean;
  tags?: string[];
};

const ROOT = 'seals';

async function apiCreateSeal(input: CreateSealInput): Promise<CachedSealNote> {
  return (await trpcClient.seals.create.mutate({
    ...input,
    color: input.color as NoteColor | null | undefined,
    pattern: input.pattern as NotePattern | null | undefined,
  })) as unknown as CachedSealNote;
}

async function apiDeleteSeal(id: string) {
  return trpcClient.seals.delete.mutate({ id });
}

async function apiUndeleteSeal({ id }: { id: string; note: CachedSealNote }) {
  return trpcClient.seals.restore.mutate({ id });
}

async function apiUpdateSeal({ id, ...data }: UpdateSealInput) {
  const handled = dispatchCommonUpdate('seals', id, data);
  if (handled) return handled;
  return (await trpcClient.seals.update.mutate({
    id,
    title: data.title,
    encryptedBody: data.encryptedBody,
    wrappedNoteKey: data.wrappedNoteKey,
    fileIds: data.fileIds,
  })) as unknown as CachedSealNote;
}

// Content-only write used by the 2-step seal create flow.
async function apiPatchSeal(
  id: string,
  data: { encryptedBody?: EncryptedPayload | null; wrappedNoteKey?: EncryptedPayload | null; fileIds?: string[] },
): Promise<CachedSealNote> {
  return (await trpcClient.seals.update.mutate({ id, ...data })) as unknown as CachedSealNote;
}

type CreateSealMutationInput = {
  title: string;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
  tags?: string[];
  encryptBody: (sealId: string) => Promise<{ encryptedBody: EncryptedPayload; wrappedNoteKey: EncryptedPayload } | null>;
};

/**
 * 2-step seal creation:
 * 1. POST with title only to get _id
 * 2. Caller encrypts body using _id
 * 3. PATCH with encryptedBody + wrappedNoteKey
 */
export const useCreateSeal = (callbacks?: { onError?: () => void }) =>
  useCreateTier<CachedSealNote, CreateSealMutationInput>(
    ROOT,
    async (input) => {
      const created = await apiCreateSeal({
        title: input.title,
        color: input.color,
        pattern: input.pattern,
        fileIds: input.fileIds,
        tags: input.tags,
      });
      const encrypted = await input.encryptBody(created._id);
      if (encrypted) {
        return apiPatchSeal(created._id, { ...encrypted, fileIds: input.fileIds });
      }
      return created;
    },
    (input, tempId) => ({ ...commonTempNote(input, tempId), encryptedBody: null, wrappedNoteKey: null }),
    callbacks,
  );

export const useDeleteSeal = () => useDeleteTier<CachedSealNote>(ROOT, apiDeleteSeal);
export const useUndeleteSeal = () => useUndeleteTier<CachedSealNote>(ROOT, apiUndeleteSeal);
export const useUpdateSeal = () => useUpdateTier<CachedSealNote>(ROOT, apiUpdateSeal, 'encryptedBody');
