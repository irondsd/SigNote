'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import s from './EmailCodeForm.module.scss';

/** Where a half-finished flow is parked, so switching to a mail app and back resumes it. */
const PENDING_KEY = 'signote-email-code-pending';
/** The code is never stored — only which address we are waiting on, and until when. */
type Pending = { email: string; until: number };

const readPending = (): Pending | null => {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending;
    return parsed.until > Date.now() ? parsed : null;
  } catch {
    return null;
  }
};

const writePending = (pending: Pending | null) => {
  try {
    if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Private mode. The flow still works, it just won't survive a reload.
  }
};

export type EmailCodeFormProps = {
  /** Asks the server to send a code. Rejects to show an error. */
  onRequestCode: (email: string) => Promise<unknown>;
  /** Verifies it. Rejects to show an error; resolving ends the flow. */
  onSubmitCode: (email: string, code: string) => Promise<unknown>;
  /** Turns a rejection into something worth reading. */
  describeError: (err: unknown, step: 'request' | 'verify') => string;
  submitLabel?: string;
  /** Prefills the address — the one Google reported, when it never verified it. */
  initialEmail?: string;
  testIdPrefix: string;
};

/**
 * The two-step address-and-code form, shared by signing in and by attaching an
 * address to an existing account. The steps are identical either way — the
 * difference is entirely in what the two callbacks do.
 */
export function EmailCodeForm({
  onRequestCode,
  onSubmitCode,
  describeError,
  submitLabel = 'Continue',
  initialEmail = '',
  testIdPrefix,
}: EmailCodeFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  // Resume rather than restart: the code is single-use, so a reload that threw
  // away the "we already sent one" state would strand the code in their inbox.
  useEffect(() => {
    const pending = readPending();
    if (pending) {
      setEmail(pending.email);
      setSent(true);
    }
  }, []);

  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);

  const request = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      await onRequestCode(address);
      setSent(true);
      setCode('');
      writePending({ email: address, until: Date.now() + 10 * 60_000 });
    } catch (err) {
      setError(describeError(err, 'request'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (!sent) {
      await request(email.trim());
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onSubmitCode(email.trim(), code.trim());
      writePending(null);
    } catch (err) {
      setError(describeError(err, 'verify'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    writePending(null);
    setSent(false);
    setCode('');
    setError('');
  };

  return (
    <form className={s.form} onSubmit={submit}>
      {sent ? (
        <>
          <p className={s.label}>
            Code sent to <span className={s.sentTo}>{email}</span>. It expires in 10 minutes.
          </p>
          <Input
            ref={codeRef}
            className={s.codeInput}
            value={code}
            // Strip separators before limiting digits; maxLength would truncate a spaced paste first.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={busy}
            aria-label="Sign-in code"
            data-testid={`${testIdPrefix}-code-input`}
          />
        </>
      ) : (
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          disabled={busy}
          aria-label="Email address"
          data-testid={`${testIdPrefix}-email-input`}
        />
      )}

      {error && (
        <p className={s.error} role="alert" data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={busy || (sent ? code.length !== 6 : !email.includes('@'))}
        data-testid={`${testIdPrefix}-submit`}
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        {sent ? submitLabel : 'Send code'}
      </Button>

      {sent && (
        <div className={s.actions}>
          <button type="button" className={s.textButton} onClick={startOver} disabled={busy}>
            Use a different address
          </button>
          <button
            type="button"
            className={s.textButton}
            onClick={() => request(email.trim())}
            disabled={busy}
            data-testid={`${testIdPrefix}-resend`}
          >
            Resend code
          </button>
        </div>
      )}
    </form>
  );
}
