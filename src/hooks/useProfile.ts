import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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
    mutationFn: (displayName: string) => {
      if (displayName.trim() === '') return Promise.reject(new Error('Display name cannot be empty'));
      if (displayName.length > 50) return Promise.reject(new Error('Display name must be 50 characters or fewer'));

      return api.patch('/api/profile', { json: { displayName } }).json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    onError: (error) => {
      toast.error('Failed to update display name. Please try again.');
      console.error('Failed to update display name:', error);
    },
  });
};
