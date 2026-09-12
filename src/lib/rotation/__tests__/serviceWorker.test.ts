/** @jest-environment jsdom */
import { rotationWorkerReady } from '@/lib/rotation/serviceWorker';

const originalChannel = globalThis.MessageChannel;
let reply: ((event: { data: unknown }) => void) | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  reply = undefined;
  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    value: class {
      port1 = {
        close() {},
        set onmessage(fn: (event: { data: unknown }) => void) {
          reply = fn;
        },
      };
      port2 = { close() {} };
    },
  });
});
afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: originalChannel });
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

it('allows a browser without a controlling worker', async () => {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: null } });
  await expect(rotationWorkerReady()).resolves.toBe(true);
});

it('requires the controlling worker to acknowledge the current protocol', async () => {
  const postMessage = jest.fn(() => reply?.({ data: { rotationProtocol: 1 } }));
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: { postMessage } } });
  await expect(rotationWorkerReady()).resolves.toBe(true);
  expect(postMessage).toHaveBeenCalled();
});

it('fails closed when an old worker does not understand the protocol', async () => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: { postMessage() {} } },
  });
  const ready = rotationWorkerReady();
  jest.advanceTimersByTime(3000);
  await expect(ready).resolves.toBe(false);
});
