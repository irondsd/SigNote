'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';

export type SessionRow = {
  _id: string;
  provider: 'google' | 'siwe';
  ip: string;
  browser: string;
  os: string;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  current: boolean;
};

export const SESSIONS_QUERY_KEY = ['sessions'] as const;

export const useSessions = () => {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  return useQuery({
    queryKey: [...SESSIONS_QUERY_KEY, userId],
    queryFn: async () => {
      const data = await api.get('/api/sessions').json<{ sessions: SessionRow[] }>();
      return data.sessions;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
};
