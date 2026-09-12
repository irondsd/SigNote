/** @jest-environment jsdom */
import { syncGeneration } from '@/lib/encryptionGenerationClient';
import { bindGenerationUser, readMarker, resetGenerationState } from '@/lib/encryptionGeneration';
jest.mock('@/lib/sessionClient', () => ({ getSessionClientHeaders: () => ({}) }));

afterEach(() => {
  resetGenerationState();
  localStorage.clear();
  jest.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'fetch');
});

it('does not share or apply a generation response across an account switch', async () => {
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = jest.fn(() => new Promise<Response>((resolve) => replies.push(resolve)));
  bindGenerationUser('alice');
  const alice = syncGeneration('alice');
  bindGenerationUser('bob');
  const bob = syncGeneration('bob');
  expect(replies).toHaveLength(2);
  replies[0]({
    ok: true,
    json: async () => ({ result: { data: { generation: 8, rotationInProgress: false } } }),
  } as Response);
  replies[1]({
    ok: true,
    json: async () => ({ result: { data: { generation: 1, rotationInProgress: false } } }),
  } as Response);
  await expect(alice).resolves.toBeNull();
  await expect(bob).resolves.toMatchObject({ resolved: { generation: 1 } });
  expect(readMarker('alice')).toBeNull();
  expect(readMarker('bob')?.generation).toBe(1);
});
