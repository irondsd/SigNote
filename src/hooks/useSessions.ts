'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { trpcClient } from '@/lib/trpcClient';

export type SessionRow = {
  _id: string;
  provider: 'google' | 'siwe' | 'email';
  client: 'web' | 'pwa' | 'desktop';
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
      const data = await trpcClient.sessions.list.query();
      return data.sessions as unknown as SessionRow[];
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
};
