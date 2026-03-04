import { NoteDocument } from '@/models/Note';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';

type UseNotesProps = {
  archived?: boolean;
};

export const useNotes = ({ archived }: UseNotesProps) => {
  const { address } = useAccount();

  return useQuery<NoteDocument[]>({
    queryKey: ['notes', address, archived ? 'archived' : 'active'],
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      if (archived !== undefined) searchParams.set('archived', String(archived));

      const endpoint = searchParams.toString() ? `/api/notes/t1?${searchParams.toString()}` : '/api/notes/t1';

      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error('Failed to fetch notes');
      }
      return res.json();
    },
    initialDataUpdatedAt: 0,
    enabled: !!address,
  });
};
