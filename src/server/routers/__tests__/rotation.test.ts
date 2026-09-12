const USER = 'user-alice';

// `protectedProcedure` authentication is covered by `lib/__tests__/routeAuth*`.
jest.mock('@/lib/routeAuth', () => {
  const actual = jest.requireActual('@/lib/routeAuth');
  return { ...actual, authenticateRequest: async () => ({ userId: USER, sid: 'sid-1', provider: 'siwe' }) };
});

// The gate must refuse before anything reaches the service, so this also proves
// no storage client, database transaction or account lock is touched.
const begin = jest.fn();
jest.mock('@/server/rotation/instance', () => ({ getRotationService: () => ({ begin }) }));

import { rotationRouter } from '@/server/routers/rotation';

const OPERATION_ID = '00000000-0000-7000-8000-000000000001';
const input = {
  operationId: OPERATION_ID,
  sourceGeneration: 0,
  profileId: 'profile-1',
  material: {
    version: 1,
    salt: Buffer.alloc(32, 1).toString('base64'),
    serverShare: Buffer.alloc(32, 2).toString('base64'),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
    keyCheck: {
      alg: 'A256GCM',
      iv: Buffer.alloc(12, 3).toString('base64'),
      ciphertext: Buffer.alloc(32, 4).toString('base64'),
    },
  },
  protocolVersion: 1,
  acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
} as never;

const caller = () =>
  rotationRouter.createCaller({ req: new Request('http://localhost/api/trpc/rotation.begin') } as never);

describe('the rotation enablement switch is a gate, not a hidden button', () => {
  const original = process.env.ROTATION_DISABLED;
  beforeEach(() => begin.mockReset().mockResolvedValue({ operationId: OPERATION_ID }));
  afterEach(() => {
    if (original === undefined) delete process.env.ROTATION_DISABLED;
    else process.env.ROTATION_DISABLED = original;
  });

  it('starts a rotation by default', async () => {
    await expect(caller().begin(input)).resolves.toBeDefined();
    expect(begin).toHaveBeenCalled();
  });

  it('refuses to start one when ROTATION_DISABLED is set', async () => {
    process.env.ROTATION_DISABLED = '1';

    await expect(caller().begin(input)).rejects.toMatchObject({ message: 'ROTATION_UNAVAILABLE' });
    expect(begin).not.toHaveBeenCalled();
  });
});
