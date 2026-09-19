jest.mock('@/lib/routeAuth', () => {
  const actual = jest.requireActual('@/lib/routeAuth');
  return { ...actual, authenticateRequest: async () => ({ userId: 'export-user', sid: 'sid', provider: 'siwe' }) };
});

import { vaultExportRouter } from '../vaultExport';

const selection = { notes: true, secrets: false, seals: false, authenticators: false };
const original = process.env.VAULT_EXPORT_DISABLED;

afterEach(() => {
  if (original === undefined) delete process.env.VAULT_EXPORT_DISABLED;
  else process.env.VAULT_EXPORT_DISABLED = original;
});

it('refuses new operations when the export feature gate is closed', async () => {
  process.env.VAULT_EXPORT_DISABLED = '1';
  const caller = vaultExportRouter.createCaller({
    req: new Request('http://localhost/api/trpc/vaultExport.begin'),
  } as never);

  await expect(caller.begin(selection)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'DISABLED' });
});
