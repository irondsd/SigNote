import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';

export type ProfileData = {
  address: string;
  createdAt: string;
  notesCount: number;
  secretsCount: number;
  sealsCount: number;
  hasEncryptionProfile: boolean;
  encryptionProfileCreatedAt: string | null;
};

export const useProfile = () => {
  const { data: session } = useSession();
  const address = session?.user?.address;

  return useQuery({
    queryKey: ['profile', address],
    queryFn: () => api.get('/api/profile').json<ProfileData>(),
    enabled: address !== undefined,
  });
};
