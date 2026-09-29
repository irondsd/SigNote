'use client';

import { MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { PasswordInput } from '@/components/PasswordInput/PasswordInput';
import s from './PassphrasePairFields.module.scss';

type PassphrasePairFieldsProps = {
  mode: 'setup' | 'replace';
  newId: string;
  confirmationId: string;
  value: string;
  confirmation: string;
  onValueChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function PassphrasePairFields({
  mode,
  newId,
  confirmationId,
  value,
  confirmation,
  onValueChange,
  onConfirmationChange,
  disabled,
  autoFocus,
}: PassphrasePairFieldsProps) {
  const replacing = mode === 'replace';

  return (
    <>
      <div className={s.field}>
        <label className={s.label} htmlFor={newId}>
          {replacing ? 'New passphrase' : 'Passphrase'}
        </label>
        <PasswordInput
          id={newId}
          autoComplete="new-password"
          placeholder={replacing ? `At least ${MIN_PASSPHRASE_LENGTH} characters` : 'Enter a strong passphrase'}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          disabled={disabled}
          toggleTabIndex={-1}
          autoFocus={autoFocus}
        />
        {replacing && value && value.length < MIN_PASSPHRASE_LENGTH && (
          <p className={s.hint}>At least {MIN_PASSPHRASE_LENGTH} characters required.</p>
        )}
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor={confirmationId}>
          {replacing ? 'Confirm new passphrase' : 'Confirm passphrase'}
        </label>
        <PasswordInput
          id={confirmationId}
          autoComplete="new-password"
          placeholder={replacing ? 'Repeat your new passphrase' : 'Repeat your passphrase'}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
          disabled={disabled}
          toggleTabIndex={-1}
        />
        {replacing && confirmation && value !== confirmation && <p className={s.error}>Passphrases do not match.</p>}
      </div>
    </>
  );
}
