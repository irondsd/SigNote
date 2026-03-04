import { NoteDocument } from '@/models/Note';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';

export const useNotes = () => {
  const { address } = useAccount();

  return useQuery<NoteDocument[]>({
    queryKey: ['notes', address],
    queryFn: async () => {
      const res = await fetch('/api/notes/t1');
      if (!res.ok) {
        throw new Error('Failed to fetch notes');
      }
      return res.json();
    },
    initialDataUpdatedAt: 0,
    enabled: !!address,
  });
};
