'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type EncryptedPayload } from '@/types/crypto';

export type CachedSecretNote = {
  _id: string;
  title: string;
  encryptedBody: EncryptedPayload | null;
  archived: boolean;
  deletedAt: string | null;
  address: string;
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

async function apiCreateSecret(input: CreateSecretInput) {
  const res = await fetch('/api/secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create secret');
  return res.json();
}

async function apiDeleteSecret(id: string) {
  const res = await fetch(`/api/secrets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete secret');
  return res.json();
}

async function apiUndeleteSecret({ id }: { id: string; note: CachedSecretNote }) {
  const res = await fetch(`/api/secrets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: false }),
  });
  if (!res.ok) throw new Error('Failed to undo delete');
  return res.json();
}

async function apiUpdateSecret({ id, ...data }: UpdateSecretInput) {
  const res = await fetch(`/api/secrets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update secret');
  return res.json();
}

export const useCreateSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateSecret,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['secrets'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSecretNote[]>>({ queryKey: ['secrets'] });

      const tempNote: CachedSecretNote = {
        _id: `temp-${Date.now()}`,
        title: input.title,
        encryptedBody: input.encryptedBody,
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
      toast.error('Failed to create secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['secrets'] }),
  });
};

export const useDeleteSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteSecret,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['secrets'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSecretNote[]>>({ queryKey: ['secrets'] });
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
      toast.error('Failed to delete secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['secrets'] }),
  });
};

export const useUndeleteSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUndeleteSecret,
    onMutate: async ({ note }) => {
      await qc.cancelQueries({ queryKey: ['secrets'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSecretNote[]>>({ queryKey: ['secrets'] });
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
      toast.error('Failed to restore secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['secrets'] }),
  });
};

export const useUpdateSecret = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateSecret,
    onMutate: async ({ id, archived, ...rest }) => {
      await qc.cancelQueries({ queryKey: ['secrets'] });
      const snapshots = qc.getQueriesData<InfiniteData<CachedSecretNote[]>>({ queryKey: ['secrets'] });
      const isArchiveToggle = archived !== undefined;

      let foundNote: CachedSecretNote | undefined;
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
      toast.error('Failed to save secret');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['secrets'] }),
  });
};
