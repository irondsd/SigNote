'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import { type EncryptedPayload } from '@/types/crypto';
import { api } from '@/lib/api';
import { cancelAndSnapshot, insertAtTop, restoreSnapshots, invalidateSnapshots } from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';
import { useDeleteTier, useUndeleteTier, useUpdateTier } from './internal/useTierMutations';

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

async function apiCreateSeal(input: CreateSealInput) {
  return api.post('/api/seals', { json: input }).json<CachedSealNote>();
}

async function apiDeleteSeal(id: string) {
  return api.delete(`/api/seals/${id}`).json();
}

async function apiUndeleteSeal({ id }: { id: string; note: CachedSealNote }) {
  return api.patch(`/api/seals/${id}`, { json: { deleted: false } }).json();
}

async function apiUpdateSeal({ id, ...data }: UpdateSealInput) {
  return api.patch(`/api/seals/${id}`, { json: data }).json();
}

async function apiPatchSeal(id: string, data: Partial<Omit<UpdateSealInput, 'id'>>) {
  return api.patch(`/api/seals/${id}`, { json: data }).json<CachedSealNote>();
}

/**
 * 2-step seal creation:
 * 1. POST with title only to get _id
 * 2. Caller encrypts body using _id
 * 3. PATCH with encryptedBody + wrappedNoteKey
 */
export const useCreateSeal = (callbacks?: { onError?: () => void }) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      title: string;
      color?: string | null;
      pattern?: string | null;
      fileIds?: string[];
      tags?: string[];
      encryptBody: (
        sealId: string,
      ) => Promise<{ encryptedBody: EncryptedPayload; wrappedNoteKey: EncryptedPayload } | null>;
    }) => {
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
    onMutate: async (input) => {
      const snapshots = await cancelAndSnapshot<CachedSealNote>(qc, ROOT);
      const tempId = `temp-${Date.now()}`;
      const tempNote: CachedSealNote = {
        _id: tempId,
        title: input.title,
        encryptedBody: null,
        wrappedNoteKey: null,
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
      if (data?._id && context?.tempId) registerStableKey(data._id, context.tempId);
      posthog.capture('seal_created');
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      posthog.capture('mutation_failed', { tier: 'seal', operation: 'create' });
      toast.error('Failed to create seal', {
        description: 'Your content has been recovered.',
        duration: Infinity,
      });
      callbacks?.onError?.();
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context?.snapshots?.length) return invalidateSnapshots(qc, context.snapshots);
      return qc.invalidateQueries({ queryKey: [ROOT] });
    },
  });
};

export const useDeleteSeal = () => useDeleteTier<CachedSealNote>(ROOT, apiDeleteSeal, 'seal');
export const useUndeleteSeal = () => useUndeleteTier<CachedSealNote>(ROOT, apiUndeleteSeal, 'seal');
export const useUpdateSeal = () => useUpdateTier<CachedSealNote>(ROOT, apiUpdateSeal, 'seal', 'encryptedBody');
