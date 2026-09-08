import { QueryClient, dehydrate, type InfiniteData } from '@tanstack/react-query';
import { confirmedQueryState } from '../confirmedQueryState';
import { rollbackItem, type Snapshot } from '../queryCache';

type Item = { _id: string; archived: boolean; title: string; position?: number };
const key = ['notes', 'user', 'active'];
const original: Item = { _id: 'one', archived: false, title: 'Confirmed' };
const pages = (items: Item[]): InfiniteData<Item[]> => ({ pages: [items], pageParams: [0] });

it('persists the last confirmed version without changing the optimistic UI or losing offline rows', () => {
  const client = new QueryClient();
  const snapshots: Snapshot<Item>[] = [[key, pages([original])]];
  const pending = client.getMutationCache().build(
    client,
    { mutationKey: ['notes'] },
    {
      context: { snapshots, patch: { title: 'Pending' } },
      variables: { id: 'one', title: 'Pending' },
      data: undefined,
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      status: 'pending',
      submittedAt: Date.now(),
    },
  );
  client.setQueryData(
    key,
    pages([
      { ...original, title: 'Pending' },
      { ...original, _id: 'temp-new', title: 'New' },
    ]),
  );
  const saved = confirmedQueryState(client, dehydrate(client));
  expect((saved.queries[0].state.data as InfiniteData<Item[]>).pages[0]).toEqual([original]);
  expect(client.getQueryData<InfiniteData<Item[]>>(key)!.pages[0][0].title).toBe('Pending');
  expect(saved.mutations).toEqual([]);
  client.getMutationCache().remove(pending);
  client.clear();
});

it('restores the moved row position on a failed reorder while retaining changes to another row', () => {
  const client = new QueryClient();
  const other = { ...original, _id: 'two', title: 'Other' };
  const snapshots: Snapshot<Item>[] = [[key, pages([original, other])]];
  client.setQueryData(
    key,
    pages([
      { ...other, title: 'Newer edit' },
      { ...original, position: 50 },
    ]),
  );
  rollbackItem(client, snapshots, 'one', { position: 50 }, true);
  expect(client.getQueryData<InfiniteData<Item[]>>(key)!.pages[0].map((row) => row.title)).toEqual([
    'Confirmed',
    'Newer edit',
  ]);
  client.clear();
});
