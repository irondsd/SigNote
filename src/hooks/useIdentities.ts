import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';

export type Identity = {
  provider: 'siwe' | 'google';
  providerSubject: string;
  email?: string;
  lastLoginAt: string;
};

export const useIdentities = () => {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: ['identities', userId],
    queryFn: () => api.get('/api/profile/identities').json<Identity[]>(),
    enabled: !!userId,
  });
};

export const useUnlinkIdentity = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useMutation({
    mutationFn: (provider: string) => api.delete(`/api/profile/identities/${provider}`).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identities', userId] });
    },
  });
};
