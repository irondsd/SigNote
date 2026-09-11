/** @jest-environment jsdom */
import '@/test/idb';

import { render, screen, waitFor } from '@testing-library/react';

import { OtpVaultProvider, useOtpVault } from '@/contexts/OtpVaultContext';
import { loadVault, saveVault } from '@/lib/otpStore';

const ALICE = 'user-alice';

const listQuery = jest.fn();
const profileQuery = jest.fn();

jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { id: 'user-alice' } } }),
}));

jest.mock('@/lib/otpTrpcClient', () => ({
  otpTrpcClient: {
    otp: { list: { query: () => listQuery() } },
    encryption: { profile: { query: () => profileQuery() } },
  },
  handleOtpUnauthorized: async () => false,
  conflictRow: () => null,
}));

function Probe() {
  const { phase, records } = useOtpVault();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="count">{records.length}</span>
    </div>
  );
}

const renderVault = () =>
  render(
    <OtpVaultProvider>
      <Probe />
    </OtpVaultProvider>,
  );

async function enrolledVault(generation: number | undefined) {
  const key = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])) as CryptoKey;
  await saveVault({
    userId: ALICE,
    key,
    profileId: 'profile-1',
    ...(generation === undefined ? {} : { generation }),
    deviceId: 'device-1',
    enrolledAt: 1,
    serverTimeOffsetMs: 0,
  });
}

beforeEach(() => {
  listQuery.mockReset();
  profileQuery.mockReset();
  listQuery.mockResolvedValue({ records: [], serverTime: Date.now() });
  localStorage.clear();
});

it('stays enrolled while the generation still matches', async () => {
  await enrolledVault(2);
  profileQuery.mockResolvedValue({ exists: true, profileId: 'profile-1', generation: 2 });

  renderVault();

  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
  expect(await loadVault(ALICE)).not.toBeNull();
});

it('enters not-enrolled when the account rotated under a stable profile id', async () => {
  await enrolledVault(2);
  // A rotation keeps the profile id and advances the generation. Matching on
  // the id alone would leave this device believing it is still enrolled.
  profileQuery.mockResolvedValue({ exists: true, profileId: 'profile-1', generation: 3 });

  renderVault();

  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('not-enrolled'));
  expect(screen.getByTestId('count').textContent).toBe('0');
  expect(await loadVault(ALICE)).toBeNull();
});

it('adopts a pre-generation enrollment only at generation zero', async () => {
  await enrolledVault(undefined);
  profileQuery.mockResolvedValue({ exists: true, profileId: 'profile-1', generation: 0 });

  renderVault();

  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
  // Recorded, so the next rotation is caught by the comparison rather than by
  // the legacy branch a second time.
  await waitFor(async () => expect((await loadVault(ALICE))?.generation).toBe(0));
});

it('treats a pre-generation enrollment on a rotated account as dead', async () => {
  await enrolledVault(undefined);
  profileQuery.mockResolvedValue({ exists: true, profileId: 'profile-1', generation: 1 });

  renderVault();

  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('not-enrolled'));
  expect(await loadVault(ALICE)).toBeNull();
});

it('treats a server that reports no generation at all as unverifiable', async () => {
  await enrolledVault(2);
  profileQuery.mockResolvedValue({ exists: true, profileId: 'profile-1' });

  renderVault();

  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('not-enrolled'));
  expect(await loadVault(ALICE)).toBeNull();
});

it('still wipes on the original profile-reset signal', async () => {
  await enrolledVault(2);
  profileQuery.mockResolvedValue({ exists: true, profileId: 'profile-2', generation: 2 });

  renderVault();

  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('not-enrolled'));
  expect(await loadVault(ALICE)).toBeNull();
});
