'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import { type EncryptedPayload } from '@/types/crypto';
import { api } from '@/lib/api';
import { cancelAndSnapshot, insertAtTop, restoreSnapshots, invalidateSnapshots } from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';
import { useDeleteTier, useUndeleteTier, useUpdateTier } from './internal/useTierMutations';

export type CachedSecretNote = {
  _id: string;
  title: string;
  encryptedBody: EncryptedPayload | null;
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

type CreateSecretInput = {
  title: string;
  encryptedBody: EncryptedPayload | null;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
};
type UpdateSecretInput = {
  id: string;
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
  pinned?: boolean;
  expiresAt?: string | null;
  burnAfterReading?: boolean;
};

const ROOT = 'secrets';

async function apiCreateSecret(input: CreateSecretInput) {
  return api.post('/api/secrets', { json: input }).json();
}

async function apiDeleteSecret(id: string) {
  return api.delete(`/api/secrets/${id}`).json();
}

async function apiUndeleteSecret({ id }: { id: string; note: CachedSecretNote }) {
  return api.patch(`/api/secrets/${id}`, { json: { deleted: false } }).json();
}

async function apiUpdateSecret({ id, ...data }: UpdateSecretInput) {
  return api.patch(`/api/secrets/${id}`, { json: data }).json();
}

export const useCreateSecret = (callbacks?: { onError?: () => void }) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateSecret,
    onMutate: async (input) => {
      const snapshots = await cancelAndSnapshot<CachedSecretNote>(qc, ROOT);
      const tempId = `temp-${Date.now()}`;
      const tempNote: CachedSecretNote = {
        _id: tempId,
        title: input.title,
        encryptedBody: input.encryptedBody,
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
      posthog.capture('secret_created');
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      posthog.capture('mutation_failed', { tier: 'secret', operation: 'create' });
      toast.error('Failed to create secret', {
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

export const useDeleteSecret = () => useDeleteTier<CachedSecretNote>(ROOT, apiDeleteSecret, 'secret');
export const useUndeleteSecret = () => useUndeleteTier<CachedSecretNote>(ROOT, apiUndeleteSecret, 'secret');
export const useUpdateSecret = () => useUpdateTier<CachedSecretNote>(ROOT, apiUpdateSecret, 'secret', 'encryptedBody');
