import { QueryClient, dehydrate, hydrate, type DehydratedState, type InfiniteData } from '@tanstack/react-query';
import { rollbackItem, sortTierLists, type Snapshot, type WithId } from '@/lib/queryCache';

/** Persist confirmed rows while keeping the live UI optimistic. Recovery drafts
 * hold in-flight content; offline reads retain the last confirmed note list. */
export function confirmedQueryState(client: QueryClient, state: DehydratedState): DehydratedState {
  const copy = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  hydrate(copy, { ...state, mutations: [] });
  const pending = client
    .getMutationCache()
    .getAll()
    .filter((mutation) => mutation.state.status === 'pending');
  for (const mutation of pending.reverse()) {
    const root = mutation.options.mutationKey?.[0];
    if (typeof root !== 'string' || !['notes', 'secrets', 'seals'].includes(root)) continue;
    const context = mutation.state.context as
      { snapshots?: Snapshot<WithId>[]; tempId?: string; reordered?: boolean; patch?: Partial<WithId> } | undefined;
    const vars = mutation.state.variables as { id?: string } | string | undefined;
    const id = context?.tempId ?? (typeof vars === 'string' ? vars : vars?.id);
    if (id && context?.snapshots) {
      rollbackItem(copy, context.snapshots, id, context.patch, context.reordered);
      if (context.patch && 'pinned' in context.patch) sortTierLists(copy, context.snapshots);
    }
  }
  // Also drop abandoned temp rows restored from older app versions.
  for (const root of ['notes', 'secrets', 'seals']) {
    copy.setQueriesData<InfiniteData<WithId[]>>({ queryKey: [root] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => page.filter((note) => !note._id.startsWith('temp-'))),
          }
        : data,
    );
  }
  const confirmed = dehydrate(copy, { shouldDehydrateMutation: () => false });
  copy.clear();
  return confirmed;
}
