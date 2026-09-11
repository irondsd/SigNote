/** @jest-environment jsdom */
import { createTRPCClient, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '@/server/routers/_app';
import { generationLink } from '@/lib/trpcLinks';
import { bindGenerationUser, observeGeneration, resetGenerationState } from '@/lib/encryptionGeneration';

jest.mock('@/lib/authRedirect', () => ({ handleUnauthorized: jest.fn() }));
jest.mock('@/lib/encryptionGenerationClient', () => ({ syncGeneration: jest.fn() }));

afterEach(() => {
  resetGenerationState();
  localStorage.clear();
});

it.each(['rotation', 'account switch'])('rejects an old response delayed across %s', async (change) => {
  bindGenerationUser('first');
  observeGeneration('first', 0);
  let deliver!: () => void;
  const transport: TRPCLink<AppRouter> = () => () =>
    observable((observer) => {
      deliver = () => {
        observer.next({ result: { data: { stale: true } } });
        observer.complete();
      };
    });
  const client = createTRPCClient<AppRouter>({ links: [generationLink, transport] });
  const response = client.encryption.profile.query();
  if (change === 'rotation') observeGeneration('first', 1);
  else bindGenerationUser('second');
  deliver();
  await expect(response).rejects.toThrow('GENERATION_MISMATCH');
});
