/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { PassphrasePairFields } from '@/components/PassphrasePairFields/PassphrasePairFields';

function Form({ mode }: { mode: 'setup' | 'replace' }) {
  const [value, setValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <PassphrasePairFields
      mode={mode}
      newId="new-passphrase"
      confirmationId="confirm-passphrase"
      value={value}
      confirmation={confirmation}
      onValueChange={setValue}
      onConfirmationChange={setConfirmation}
    />
  );
}

it('shows length and mismatch feedback while replacing a passphrase', () => {
  render(<Form mode="replace" />);

  fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: 'short' } });
  expect(screen.getByText(`At least ${MIN_PASSPHRASE_LENGTH} characters required.`)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Confirm new passphrase'), { target: { value: 'different' } });
  expect(screen.getByText('Passphrases do not match.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: 'different' } });
  expect(screen.queryByText('Passphrases do not match.')).not.toBeInTheDocument();
});

it('keeps setup labels and leaves validation to the setup form', () => {
  render(<Form mode="setup" />);
  fireEvent.change(screen.getByLabelText('Passphrase', { exact: true }), { target: { value: 'short' } });
  expect(screen.getByLabelText('Confirm passphrase')).toBeInTheDocument();
  expect(screen.queryByText(/characters required/)).not.toBeInTheDocument();
});
