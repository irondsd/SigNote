import { NoteDocument } from '@/models/Note';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

type UseNotesProps = {
  archived?: boolean;
};

export const useNotes = ({ archived }: UseNotesProps) => {
  const { data: session } = useSession();
  const address = session?.user?.address;

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
