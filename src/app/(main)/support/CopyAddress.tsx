'use client';

import { Check, Copy } from 'lucide-react';
import useCopy from '@/hooks/useCopy';
import s from './page.module.scss';

type CopyAddressProps = {
  address: string;
  /** Wallet name, so the button reads as its own thing to a screen reader. */
  label: string;
};

export function CopyAddress({ address, label }: CopyAddressProps) {
  const { isCopied, copy } = useCopy(address);

  return (
    <div className={s.addressRow}>
      <code className={s.address}>{address}</code>
      <button
        type="button"
        onClick={copy}
        className={s.copyButton}
        data-copied={isCopied || undefined}
        aria-label={`Copy ${label} address`}
      >
        {isCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span>{isCopied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
