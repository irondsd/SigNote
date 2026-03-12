'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type EncryptedPayload } from '@/types/crypto';

export type CachedSealNote = {
  _id: string;
  title: string;
  encryptedBody: EncryptedPayload | null;
  wrappedNoteKey: EncryptedPayload | null;
  archived: boolean;
  deletedAt: string | null;
  address: string;
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

async function apiCreateSeal(input: CreateSealInput) {
  const res = await fetch('/api/seals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create seal');
  return res.json() as Promise<CachedSealNote>;
}

async function apiDeleteSeal(id: string) {
  const res = await fetch(`/api/seals/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete seal');
  return res.json();
}

async function apiUndeleteSeal({ id }: { id: string; note: CachedSealNote }) {
  const res = await fetch(`/api/seals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: false }),
  });
  if (!res.ok) throw new Error('Failed to undo delete');
  return res.json();
}

async function apiUpdateSeal({ id, ...data }: UpdateSealInput) {
  const res = await fetch(`/api/seals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update seal');
  return res.json();
}

async function apiPatchSeal(id: string, data: Partial<Omit<UpdateSealInput, 'id'>>) {
  const res = await fetch(`/api/seals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update seal');
  return res.json() as Promise<CachedSealNote>;
}

/**
 * 2-step seal creation:
 * 1. POST with title only to get _id
 * 2. Caller encrypts body using _id
 * 3. PATCH with encryptedBody + wrappedNoteKey
 */
export const useCreateSeal = () => {
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (input: {
      title: string;
      encryptBody: (
        sealId: string,
      ) => Promise<{ encryptedBody: EncryptedPayload; wrappedNoteKey: EncryptedPayload } | null>;
    }) => {
      // Step 1: create with title only
      const created = await apiCreateSeal({ title: input.title });

      // Step 2: encrypt body if encryptBody provided
      const encrypted = await input.encryptBody(created._id);

      if (encrypted) {
        // Step 3: patch with encrypted body
        return apiPatchSeal(created._id, encrypted);
      }

      return created;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['seals'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSealNote[]>>({ queryKey: ['seals'] });

      const tempNote: CachedSealNote = {
        _id: `temp-${Date.now()}`,
        title: input.title,
        encryptedBody: null,
        wrappedNoteKey: null,
        archived: false,
        deletedAt: null,
        address: '',
        position: -1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        color: null,
      };

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        if (queryKey[2] === 'archived') return;
        const firstPage = data.pages[0] ?? [];
        qc.setQueryData(queryKey, {
          ...data,
          pages: [[tempNote, ...firstPage], ...data.pages.slice(1)],
        });
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to create seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seals'] }),
  });

  return createMutation;
};

export const useDeleteSeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteSeal,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['seals'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSealNote[]>>({ queryKey: ['seals'] });
      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        qc.setQueryData(queryKey, {
          ...data,
          pages: data.pages.map((page) => page.filter((n) => n._id !== id)),
        });
      });
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to delete seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seals'] }),
  });
};

export const useUndeleteSeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUndeleteSeal,
    onMutate: async ({ note }) => {
      await qc.cancelQueries({ queryKey: ['seals'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSealNote[]>>({ queryKey: ['seals'] });
      const restored = { ...note, deletedAt: null };

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        if (queryKey[2] === 'archived') return;
        const firstPage = data.pages[0] ?? [];
        qc.setQueryData(queryKey, {
          ...data,
          pages: [[restored, ...firstPage], ...data.pages.slice(1)],
        });
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to restore seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seals'] }),
  });
};

export const useUpdateSeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateSeal,
    onMutate: async ({ id, archived, ...rest }) => {
      await qc.cancelQueries({ queryKey: ['seals'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSealNote[]>>({ queryKey: ['seals'] });
      const isArchiveToggle = archived !== undefined;

      let foundNote: CachedSealNote | undefined;
      if (isArchiveToggle) {
        for (const [, data] of snapshots) {
          if (!data) continue;
          for (const page of data.pages) {
            const n = page.find((note) => note._id === id);
            if (n) {
              foundNote = n;
              break;
            }
          }
          if (foundNote) break;
        }
      }

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        const isArchivedView = queryKey[2] === 'archived';

        if (isArchiveToggle && foundNote) {
          const noteNowBelongsHere = (archived === true) === isArchivedView;
          if (noteNowBelongsHere) {
            const updated = { ...foundNote, ...rest, archived: archived! };
            const firstPage = data.pages[0] ?? [];
            qc.setQueryData(queryKey, {
              ...data,
              pages: [[updated, ...firstPage.filter((n) => n._id !== id)], ...data.pages.slice(1)],
            });
          } else {
            qc.setQueryData(queryKey, {
              ...data,
              pages: data.pages.map((page) => page.filter((n) => n._id !== id)),
            });
          }
        } else {
          qc.setQueryData(queryKey, {
            ...data,
            pages: data.pages.map((page) =>
              page.map((n) => (n._id === id ? { ...n, ...rest, archived: archived ?? n.archived } : n)),
            ),
          });
        }
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
      toast.error('Failed to save seal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seals'] }),
  });
};
