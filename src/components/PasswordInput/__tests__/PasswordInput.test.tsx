/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { PasswordInput } from '@/components/PasswordInput/PasswordInput';

it('reveals only the selected field and keeps its value while toggling', () => {
  render(
    <>
      <label htmlFor="new-password">New passphrase</label>
      <PasswordInput id="new-password" value="first value" onChange={() => {}} />
      <label htmlFor="confirm-password">Confirm passphrase</label>
      <PasswordInput id="confirm-password" value="second value" onChange={() => {}} />
    </>,
  );

  const first = screen.getByLabelText('New passphrase');
  const second = screen.getByLabelText('Confirm passphrase');
  expect(first).toHaveAttribute('type', 'password');
  expect(second).toHaveAttribute('type', 'password');

  fireEvent.click(screen.getAllByRole('button', { name: 'Show passphrase' })[0]);
  expect(first).toHaveAttribute('type', 'text');
  expect(first).toHaveValue('first value');
  expect(second).toHaveAttribute('type', 'password');
  expect(screen.getByRole('button', { name: 'Hide passphrase' })).toHaveAttribute('aria-pressed', 'true');
});

it('forwards input attributes and disables its reveal control with the input', () => {
  render(
    <PasswordInput
      aria-label="Archive password"
      visibilityLabel="archive password"
      disabled
      autoComplete="new-password"
    />,
  );

  expect(screen.getByLabelText('Archive password')).toHaveAttribute('autocomplete', 'new-password');
  expect(screen.getByRole('button', { name: 'Show archive password' })).toBeDisabled();
});
