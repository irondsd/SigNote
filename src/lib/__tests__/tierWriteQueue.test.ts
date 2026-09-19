import { setActiveAccountId } from '@/lib/accountScope';
import { AccountChangedDuringWriteError, queueTierWrite } from '@/lib/tierWriteQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => setActiveAccountId('alice'));
afterEach(() => setActiveAccountId(null));

it('does not execute a queued write after the active account changes', async () => {
  const first = deferred<void>();
  const firstWrite = jest.fn(() => first.promise);
  const queuedWrite = jest.fn(async () => undefined);

  const running = queueTierWrite('seals', 'same-id', firstWrite);
  const queued = queueTierWrite('seals', 'same-id', queuedWrite);
  await Promise.resolve();
  expect(firstWrite).toHaveBeenCalledTimes(1);

  setActiveAccountId('bob');
  first.resolve();
  await running;
  await expect(queued).rejects.toBeInstanceOf(AccountChangedDuringWriteError);
  expect(queuedWrite).not.toHaveBeenCalled();
});

it('keeps click order within one account and record', async () => {
  const first = deferred<void>();
  const order: string[] = [];
  const running = queueTierWrite('notes', 'one', async () => {
    order.push('first:start');
    await first.promise;
    order.push('first:end');
  });
  const queued = queueTierWrite('notes', 'one', async () => {
    order.push('second');
  });

  await Promise.resolve();
  first.resolve();
  await Promise.all([running, queued]);
  expect(order).toEqual(['first:start', 'first:end', 'second']);
});
