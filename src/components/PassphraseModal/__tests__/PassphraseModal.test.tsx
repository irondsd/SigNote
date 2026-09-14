/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import posthog from 'posthog-js';

import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { EncryptionMaterialUnavailableError } from '@/lib/encryptionMaterial';
import { IncorrectPassphraseError } from '@/lib/vaultKey';

const unlock = jest.fn();
const preloadUnlockMaterial = jest.fn();
const clearPreloadedUnlockMaterial = jest.fn();

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { capture: jest.fn() },
}));

jest.mock('@/contexts/EncryptionContext', () => ({
  useEncryption: () => ({ unlock, preloadUnlockMaterial, clearPreloadedUnlockMaterial }),
}));

const renderModal = () => render(<PassphraseModal onSuccess={jest.fn()} onClose={jest.fn()} />);

const submitPassphrase = () => {
  fireEvent.change(screen.getByLabelText('Encryption passphrase'), { target: { value: 'test passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('preloads material while the modal is open and clears it on close', () => {
  const view = renderModal();

  expect(preloadUnlockMaterial).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(clearPreloadedUnlockMaterial).toHaveBeenCalledTimes(1);
});

it('identifies an incorrect passphrase and offers recovery', async () => {
  unlock.mockRejectedValueOnce(new IncorrectPassphraseError());
  renderModal();
  submitPassphrase();

  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect passphrase. Please try again.');
  expect(screen.getByRole('link', { name: /recover/i })).toBeInTheDocument();
  expect(posthog.capture).toHaveBeenCalledWith('vault_unlock_failed', { reason: 'incorrect_passphrase' });
});

it('identifies a material request failure without blaming the passphrase', async () => {
  unlock.mockRejectedValueOnce(new EncryptionMaterialUnavailableError(new Error('offline')));
  renderModal();
  submitPassphrase();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    "We couldn't load the encryption data needed to unlock your notes. Your passphrase wasn't checked. Check your connection and try again.",
  );
  expect(screen.queryByRole('link', { name: /recover/i })).not.toBeInTheDocument();
  expect(posthog.capture).toHaveBeenCalledWith('vault_unlock_failed', { reason: 'material_unavailable' });
});
