/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

jest.mock('posthog-js', () => ({ capture: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/lib/trpcClient', () => ({
  trpcClient: {
    promotions: {
      prepareSecret: { query: jest.fn() },
      secretToSeal: { mutate: jest.fn() },
    },
  },
}));

import { trpcClient } from '@/lib/trpcClient';
import { usePromoteSecretToSeal } from '@/hooks/usePromotions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const prepareSecret = trpcClient.promotions.prepareSecret.query as unknown as jest.Mock;
const commitPromotion = trpcClient.promotions.secretToSeal.mutate as unknown as jest.Mock;
const showSuccess = toast.success as jest.Mock;
const push = jest.fn();
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  (useRouter as jest.Mock).mockReturnValue({ push });
  push.mockReset();
  showSuccess.mockReset();
  prepareSecret.mockReset().mockResolvedValue({
    secret: { _id: 'secret-id', encryptedBody: null, updatedAt: '2026-09-14T00:00:00.000Z' },
    versions: [],
  });
  commitPromotion.mockReset().mockResolvedValue({ id: 'secret-id', archived: false, generation: 1 });
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
});

afterEach(() => queryClient.clear());

it('waits for the source version query to be cancelled before promotion starts', async () => {
  let finishCancellation!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    finishCancellation = resolve;
  });
  const cancelQueries = jest.spyOn(queryClient, 'cancelQueries').mockReturnValue(cancellation);
  const hook = renderHook(() => usePromoteSecretToSeal(), { wrapper });

  let promotion!: Promise<unknown>;
  act(() => {
    promotion = hook.result.current.mutateAsync({ id: 'secret-id', mek: {} as CryptoKey });
  });

  await waitFor(() =>
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: ['versions', 'secrets', 'secret-id'],
      exact: true,
    }),
  );
  expect(prepareSecret).not.toHaveBeenCalled();

  await act(async () => {
    finishCancellation();
    await promotion;
  });
  expect(prepareSecret).toHaveBeenCalledWith({ id: 'secret-id' });
  expect(commitPromotion).toHaveBeenCalledTimes(1);

  const toastOptions = showSuccess.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
  expect(toastOptions.action.label).toBe('Open');
  toastOptions.action.onClick();
  expect(push).toHaveBeenCalledWith('/seals?id=secret-id');
});
