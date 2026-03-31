import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';

export type ProfileData = {
  displayName: string;
  createdAt: string;
  notesCount: number;
  secretsCount: number;
  sealsCount: number;
  hasEncryptionProfile: boolean;
  encryptionProfileCreatedAt: string | null;
};

export const useProfile = () => {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get('/api/profile').json<ProfileData>(),
    enabled: userId !== undefined,
  });
};

export const useUpdateDisplayName = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useMutation({
    mutationFn: (displayName: string) =>
      api.patch('/api/profile', { json: { displayName } }).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });
};
