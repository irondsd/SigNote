/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useRehydratingEncryptionAction } from '@/hooks/useRehydratingEncryptionAction';
import type { LockType } from '@/contexts/EncryptionContext';

const mek = {} as CryptoKey;

function setup(lockType: LockType, rehydrate: () => Promise<CryptoKey>) {
  const save = jest.fn(async () => {});
  const decrypt = jest.fn(async () => {});
  const execute = jest.fn(async (action: (key: CryptoKey) => Promise<void>) => action(mek));
  const props = { mek: null as CryptoKey | null, lockType, rehydrate, execute, actions: { save, decrypt } };
  const hook = renderHook((options) => useRehydratingEncryptionAction(options), { initialProps: props });
  return { ...hook, props, save, decrypt, execute };
}

it('runs the pending action once when a soft lock rehydrates the MEK', async () => {
  const rehydrate = jest.fn(async () => mek);
  const { result, rerender, props, save, decrypt, execute } = setup('soft', rehydrate);

  await act(async () => result.current('save'));
  expect(rehydrate).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();

  rerender({ ...props, mek });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  rerender({ ...props, mek });
  expect(save).toHaveBeenCalledWith(mek);
  expect(save).toHaveBeenCalledTimes(1);
  expect(decrypt).not.toHaveBeenCalled();
});

it('falls back to the passphrase guard after failed rehydration without replaying later', async () => {
  const rehydrate = jest.fn(async (): Promise<CryptoKey> => {
    throw new Error('no session key');
  });
  const { result, rerender, props, save, execute } = setup('soft', rehydrate);

  await act(async () => result.current('save'));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);

  rerender({ ...props, mek });
  expect(save).toHaveBeenCalledTimes(1);
});

it('does not fall back after rehydration publishes a MEK and then reports failure', async () => {
  let fail!: (error: Error) => void;
  const rehydrate = jest.fn(
    () =>
      new Promise<CryptoKey>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const { result, rerender, props, save, execute } = setup('soft', rehydrate);
  let request!: Promise<void>;

  act(() => {
    request = result.current('save');
  });
  rerender({ ...props, mek });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await act(async () => {
    fail(new Error('late failure'));
    await request;
  });

  expect(execute).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
});

it('uses the guard directly when there is no soft lock', async () => {
  const rehydrate = jest.fn(async () => mek);
  const { result, decrypt, execute } = setup('none', rehydrate);

  await act(async () => result.current('decrypt'));
  expect(rehydrate).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(decrypt).toHaveBeenCalledWith(mek);
});
