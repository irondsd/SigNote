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
};

type CreateSealInput = {
  title: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
};

type UpdateSealInput = {
  id: string;
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
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
      encryptBody: (
        sealId: string,
      ) => Promise<{ encryptedBody: EncryptedPayload; wrappedNoteKey: EncryptedPayload } | null>;
    }) => {
      const created = await apiCreateSeal({ title: input.title });
      const encrypted = await input.encryptBody(created._id);
      if (encrypted) {
        return apiPatchSeal(created._id, encrypted);
      }
      return created;
    },
    onMutate: async (input) => {
      const snapshots = await cancelAndSnapshot<CachedSealNote>(qc, ROOT);
      const tempNote: CachedSealNote = {
        _id: `temp-${Date.now()}`,
        title: input.title,
        encryptedBody: null,
        wrappedNoteKey: null,
        archived: false,
        deletedAt: null,
        position: -1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        color: null,
      };
      insertAtTop(qc, snapshots, tempNote);
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to create seal', {
        description: 'Your content has been recovered.',
        duration: Infinity,
      });
      callbacks?.onError?.();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useDeleteSeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteSeal,
    onMutate: async (id) => {
      const snapshots = await cancelAndSnapshot<CachedSealNote>(qc, ROOT);
      filterOut(qc, snapshots, id);
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to delete seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useUndeleteSeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUndeleteSeal,
    onMutate: async ({ note }) => {
      const snapshots = await cancelAndSnapshot<CachedSealNote>(qc, ROOT);
      insertAtTop(qc, snapshots, { ...note, deletedAt: null });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to restore seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};

export const useUpdateSeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateSeal,
    onMutate: async ({ id, archived, ...rest }) => {
      const snapshots = await cancelAndSnapshot<CachedSealNote>(qc, ROOT);
      if (archived !== undefined) {
        toggleArchive(qc, snapshots, id, archived, rest as Partial<CachedSealNote>);
      } else {
        patchInPlace(qc, snapshots, id, rest as Partial<CachedSealNote>);
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error('Failed to save seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
};
