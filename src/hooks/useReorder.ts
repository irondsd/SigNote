'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Resource = 'notes' | 'secrets' | 'seals';

type ReorderInput = {
  id: string;
  position: number;
  oldIndex: number;
  newIndex: number;
};

type WithId = { _id: string };

export function useReorder<T extends WithId>(resource: Resource) {
  const qc = useQueryClient();
  const queryKey = resource;

  return useMutation({
    mutationFn: ({ id, position }: ReorderInput) =>
      api.patch(`/api/${queryKey}/${id}`, { json: { position } }).json(),
    onMutate: async ({ id, position, newIndex }) => {
      await qc.cancelQueries({ queryKey: [queryKey] });
      const snapshots = qc.getQueriesData<InfiniteData<T[]>>({ queryKey: [queryKey] });

      snapshots.forEach(([key, data]) => {
        if (!data) return;

        const allItems = data.pages.flat();
        const itemIndex = allItems.findIndex((n) => n._id === id);
        if (itemIndex === -1) return;

        const [movedItem] = allItems.splice(itemIndex, 1);
        allItems.splice(newIndex, 0, { ...movedItem, position });

        const newPages: T[][] = [];
        let offset = 0;
        for (const page of data.pages) {
          newPages.push(allItems.slice(offset, offset + page.length));
          offset += page.length;
        }

        qc.setQueryData(key, { ...data, pages: newPages });
      });

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(`Failed to reorder ${resource}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [queryKey] }),
  });
}
