'use client';

import { useQueryClient, useMutation, InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queueTierWrite } from '@/lib/tierWriteQueue';
import { rollbackItem } from '@/lib/queryCache';
import { trpcClient } from '@/lib/trpcClient';

type Resource = 'notes' | 'secrets' | 'seals';

type ReorderInput = {
  id: string;
  position: number;
  oldIndex: number;
  newIndex: number;
};

type WithId = { _id: string; archived: boolean };

export function useReorder<T extends WithId>(resource: Resource) {
  const qc = useQueryClient();
  const queryKey = resource;

  return useMutation({
    networkMode: 'always',
    mutationKey: [resource],
    mutationFn: async ({ id, position }: ReorderInput) =>
      queueTierWrite(resource, id, () => trpcClient[resource].setPosition.mutate({ id, position })),
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

      return { snapshots, reordered: true };
    },
    onError: (_err, _vars, context) => {
      if (context) rollbackItem(qc, context.snapshots, _vars.id, undefined, true);
      toast.error(`Failed to reorder ${resource}`);
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: [resource] }) <= 1) return qc.invalidateQueries({ queryKey: [queryKey] });
    },
  });
}
