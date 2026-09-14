/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

jest.mock('@/lib/trpcClient', () => {
  const tier = () => ({ versions: { list: { query: jest.fn() } } });
  return { trpcClient: { notes: tier(), secrets: tier(), seals: tier() } };
});

import { trpcClient } from '@/lib/trpcClient';
import { useVersions } from '@/hooks/useVersions';

const listVersions = trpcClient.notes.versions.list.query as unknown as jest.Mock;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  listVersions.mockReset().mockResolvedValue([]);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => queryClient.clear());

it('forwards the query abort signal to tRPC', async () => {
  renderHook(() => useVersions('notes', 'note-id'), { wrapper });

  await waitFor(() => expect(listVersions).toHaveBeenCalledTimes(1));
  expect(listVersions.mock.calls[0][0]).toEqual({ id: 'note-id' });
  expect(listVersions.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});
