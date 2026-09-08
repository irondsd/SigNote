/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { useCreateTier, useDeleteTier, useUndeleteTier, useUpdateTier } from '../useTierMutations';

jest.mock('posthog-js', () => ({ capture: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/hooks/useVersions', () => ({ versionsKey: (tier: string, id: string) => ['versions', tier, id] }));

type Item = { _id: string; archived: boolean; title: string; content: string; updatedAt: string; color?: string };
const key = ['notes', 'user', 'active'];
const original: Item = { _id: 'one', archived: false, title: 'Old', content: 'original', updatedAt: 'yesterday' };
let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const items = () => qc.getQueryData<InfiniteData<Item[]>>(key)!.pages.flat();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  qc.setQueryData(key, { pages: [[original]], pageParams: [0] });
});
afterEach(() => qc.clear());

it('creates immediately, replaces the temporary id without refetch, and survives unmount', async () => {
  const request = deferred<Item>();
  const hook = renderHook(
    () =>
      useCreateTier(
        'notes',
        () => request.promise,
        (input: Item, id) => ({ ...input, _id: id }),
      ),
    { wrapper },
  );
  act(() => hook.result.current.mutate({ ...original, title: 'New' }));
  await waitFor(() => expect(items()[0]._id).toMatch(/^temp-/));
  hook.unmount();
  await act(async () => request.resolve({ ...original, _id: 'server-id', title: 'New' }));
  expect(items()[0]._id).toBe('server-id');
});

it('a failed create does not roll back a different in-flight create', async () => {
  const first = deferred<Item>();
  const second = deferred<Item>();
  const hook = renderHook(
    () =>
      useCreateTier(
        'notes',
        (input: Item) => (input.title === 'First' ? first.promise : second.promise),
        (input, id) => ({ ...input, _id: id }),
      ),
    { wrapper },
  );
  act(() => hook.result.current.mutate({ ...original, title: 'First' }));
  await waitFor(() => expect(items()).toHaveLength(2));
  act(() => hook.result.current.mutate({ ...original, title: 'Second' }));
  await waitFor(() => expect(items()).toHaveLength(3));
  await act(async () => first.reject(new Error('offline')));
  expect(items().map((i) => i.title)).toEqual(['Second', 'Old']);
  await act(async () => second.resolve({ ...original, _id: 'second', title: 'Second' }));
});

it('metadata is immediate and rolls back without changing the content timestamp', async () => {
  const request = deferred<void>();
  const hook = renderHook(() => useUpdateTier<Item>('notes', () => request.promise, 'content'), { wrapper });
  act(() => hook.result.current.mutate({ id: 'one', color: 'red' }));
  await waitFor(() => expect(items()[0].color).toBe('red'));
  expect(items()[0].updatedAt).toBe('yesterday');
  await act(async () => request.reject(new Error('offline')));
  expect(items()[0].color).toBeUndefined();
});

it('archive and restore move immediately between cached views and roll back on failure', async () => {
  const archivedKey = ['notes', 'user', 'archived'];
  qc.setQueryData(archivedKey, { pages: [[]], pageParams: [0] });
  const request = deferred<void>();
  const hook = renderHook(() => useUpdateTier<Item>('notes', () => request.promise, 'content'), { wrapper });
  act(() => hook.result.current.mutate({ id: 'one', archived: true }));
  await waitFor(() => expect(items()).toHaveLength(0));
  expect(qc.getQueryData<InfiniteData<Item[]>>(archivedKey)!.pages[0][0].archived).toBe(true);
  await act(async () => request.reject(new Error('offline')));
  expect(items()).toEqual([original]);
  expect(qc.getQueryData<InfiniteData<Item[]>>(archivedKey)!.pages[0]).toHaveLength(0);
});

it('delete and immediate Undo reach the server in order while Undo is already visible', async () => {
  const deletion = deferred<void>();
  const restoration = deferred<void>();
  const restore = jest.fn(() => restoration.promise);
  const hook = renderHook(
    () => ({
      remove: useDeleteTier<Item>('notes', () => deletion.promise),
      undo: useUndeleteTier<Item>('notes', restore),
    }),
    { wrapper },
  );
  act(() => hook.result.current.remove.mutate('one'));
  await waitFor(() => expect(items()).toHaveLength(0));
  act(() => hook.result.current.undo.mutate({ id: 'one', note: original }));
  await waitFor(() => expect(items()).toHaveLength(1));
  expect(restore).not.toHaveBeenCalled();
  await act(async () => deletion.resolve());
  expect(restore).toHaveBeenCalledTimes(1);
  await act(async () => restoration.resolve());
});

it.each([
  ['pattern', 'grid'],
  ['tags', ['tag-one']],
  ['expiresAt', '2099-01-01T00:00:00.000Z'],
  ['burnAfterReading', true],
])('%s changes immediately and rolls back on failure', async (field, value) => {
  const request = deferred<void>();
  const hook = renderHook(() => useUpdateTier<Item>('notes', () => request.promise, 'content'), { wrapper });
  act(() => hook.result.current.mutate({ id: 'one', [field as string]: value }));
  await waitFor(() => expect((items()[0] as unknown as Record<string, unknown>)[field as string]).toEqual(value));
  expect(items()[0].updatedAt).toBe('yesterday');
  await act(async () => request.reject(new Error('offline')));
  expect((items()[0] as unknown as Record<string, unknown>)[field as string]).toBeUndefined();
});

it('pinning reorders the list before the response and restores its order on failure', async () => {
  qc.setQueryData(key, {
    pages: [
      [
        { ...original, position: 200 },
        { ...original, _id: 'two', position: 100 },
      ],
    ],
    pageParams: [0],
  });
  const request = deferred<void>();
  const hook = renderHook(() => useUpdateTier<Item>('notes', () => request.promise, 'content'), { wrapper });
  act(() => hook.result.current.mutate({ id: 'two', pinned: true }));
  await waitFor(() => expect(items()[0]._id).toBe('two'));
  await act(async () => request.reject(new Error('offline')));
  expect(items().map((item) => item._id)).toEqual(['one', 'two']);
});
