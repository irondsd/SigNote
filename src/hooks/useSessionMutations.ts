'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { SESSIONS_QUERY_KEY, type SessionRow } from './useSessions';

type RevokeResponse = { revoked: boolean; wasCurrent: boolean };
type RevokeAllResponse = { revoked: number };

const findCacheKeys = (qc: ReturnType<typeof useQueryClient>) =>
  qc.getQueryCache().findAll({ queryKey: SESSIONS_QUERY_KEY }).map((q) => q.queryKey);

export const useRevokeSession = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/api/sessions/${id}`).json<RevokeResponse>();
    },
    onMutate: async (id) => {
      const keys = findCacheKeys(qc);
      await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));
      const snapshots = keys.map((key) => ({ key, data: qc.getQueryData<SessionRow[]>(key) }));
      for (const { key, data } of snapshots) {
        if (data) qc.setQueryData<SessionRow[]>(key, data.filter((s) => s._id !== id));
      }
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(({ key, data }) => qc.setQueryData(key, data));
      toast.error('Failed to revoke session.');
    },
    onSuccess: (data) => {
      if (data.wasCurrent) {
        // The current session is gone — sign the user out client-side too.
        toast.success('Signed out.');
        signOut({ callbackUrl: '/' });
      } else {
        toast.success('Session revoked.');
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });
};

export const useRevokeAllOtherSessions = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return api.delete('/api/sessions').json<RevokeAllResponse>();
    },
    onMutate: async () => {
      const keys = findCacheKeys(qc);
      await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: k })));
      const snapshots = keys.map((key) => ({ key, data: qc.getQueryData<SessionRow[]>(key) }));
      for (const { key, data } of snapshots) {
        if (data) qc.setQueryData<SessionRow[]>(key, data.filter((s) => s.current));
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(({ key, data }) => qc.setQueryData(key, data));
      toast.error('Failed to revoke other sessions.');
    },
    onSuccess: (data) => {
      if (data.revoked === 0) {
        toast.info('No other sessions to revoke.');
      } else {
        toast.success(`Signed out of ${data.revoked} other session${data.revoked === 1 ? '' : 's'}.`);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });
};
