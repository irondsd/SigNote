import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { trpcClient } from '@/lib/trpcClient';

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
    queryFn: async () => (await trpcClient.identities.list.query()) as unknown as Identity[],
    enabled: !!userId,
  });
};

export const useUnlinkIdentity = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useMutation({
    mutationFn: (provider: string) => trpcClient.identities.unlink.mutate({ provider: provider as 'siwe' | 'google' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identities', userId] });
    },
  });
};
