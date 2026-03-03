import { NoteDocument } from '@/models/Note';
import { useQuery } from '@tanstack/react-query';

export const useNotes = () => {
  return useQuery<NoteDocument[]>({
    queryKey: ['notes'],
    queryFn: async () => {
      const res = await fetch('/api/notes/t1');
      if (!res.ok) {
        throw new Error('Failed to fetch notes');
      }
      return res.json();
    },
    initialData: [],
  });
};
