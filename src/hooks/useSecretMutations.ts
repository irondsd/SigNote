'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type EncryptedPayload } from '@/types/crypto';
import { api } from '@/lib/api';
import {
  cancelAndSnapshot,
  insertAtTop,
  filterOut,
  patchInPlace,
  toggleArchive,
  restoreSnapshots,
} from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';

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
};

type CreateSecretInput = { title: string; encryptedBody: EncryptedPayload | null };
type UpdateSecretInput = {
  id: string;
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
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
        color: null,
      };
      insertAtTop(qc, snapshots, tempNote);
      return { snapshots, tempId };
    },
    onSuccess: (data, _vars, context) => {
      const realId = (data as { _id: string })?._id;
      if (realId && context?.tempId) registerStableKey(realId, context.tempId);
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to create secret', {
        description: 'Your content has been recovered.',
        duration: Infinity,
      });
      callbacks?.onError?.();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useDeleteSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteSecret,
    onMutate: async (id) => {
      const snapshots = await cancelAndSnapshot<CachedSecretNote>(qc, ROOT);
      filterOut(qc, snapshots, id);
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to delete secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useUndeleteSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUndeleteSecret,
    onMutate: async ({ note }) => {
      const snapshots = await cancelAndSnapshot<CachedSecretNote>(qc, ROOT);
      insertAtTop(qc, snapshots, { ...note, deletedAt: null });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to restore secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useUpdateSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateSecret,
    onMutate: async ({ id, archived, ...rest }) => {
      const snapshots = await cancelAndSnapshot<CachedSecretNote>(qc, ROOT);
      if (archived !== undefined) {
        toggleArchive(qc, snapshots, id, archived, rest as Partial<CachedSecretNote>);
      } else {
        patchInPlace(qc, snapshots, id, rest as Partial<CachedSecretNote>);
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to save secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};
