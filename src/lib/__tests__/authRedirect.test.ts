/** @jest-environment jsdom */

const signOut = jest.fn();
jest.mock('next-auth/react', () => ({ signOut }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/lib/otpStore', () => ({ removeAllVaults: jest.fn(async () => undefined) }));

// Fresh per test: the module keeps its sign-out state at module scope.
const load = () => import('@/lib/authRedirect');

beforeEach(() => {
  jest.resetModules();
  signOut.mockReset();
});

it('signs out when a request is refused', async () => {
  await (await load()).handleUnauthorized();
  expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' });
});

it('ignores the 401s that follow a deliberate sign-out', async () => {
  const { handleUnauthorized, noteDeliberateSignOut } = await load();
  noteDeliberateSignOut();
  await handleUnauthorized();
  expect(signOut).not.toHaveBeenCalled();
});
