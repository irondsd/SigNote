'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/utils/cn';
import s from './EmailCodeForm.module.scss';

/** Where a half-finished flow is parked, so switching to a mail app and back resumes it. */
const PENDING_KEY = 'signote-email-code-pending';
/** The code is never stored — only which address we are waiting on, and until when. */
type Pending = { email: string; until: number };

const CODE_LENGTH = 6;
/** Mirrors the server's TTL; the copy promises the same number. */
const CODE_TTL_MS = 10 * 60_000;
/**
 * How long "Resend" stays quiet after a send. Long enough for a slow mail hop
 * to land before the second request retires the first code, short enough
 * not to feel like a punishment when the first one really did go missing.
 */
const RESEND_COOLDOWN_MS = 20_000;

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

const formatCountdown = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export type EmailCodeFormProps = {
  /** Asks the server to send a code. Rejects to show an error. */
  onRequestCode: (email: string) => Promise<unknown>;
  /** Verifies it. Rejects to show an error; resolving ends the flow. */
  onSubmitCode: (email: string, code: string) => Promise<unknown>;
  /** Turns a rejection into something worth reading. */
  describeError: (err: unknown, step: 'request' | 'verify') => string;
  submitLabel?: string;
  /**
   * Heading over the address step. Leave it out when the surface around the
   * form already says what it is for.
   */
  intro?: { title: string; description: string };
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
  submitLabel = 'Verify and continue',
  intro,
  initialEmail = '',
  testIdPrefix,
}: EmailCodeFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  /** When the current code went out; drives the resend cooldown. */
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [codeFocused, setCodeFocused] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // Resume rather than restart: the code is single-use, so a reload that threw
  // away the "we already sent one" state would strand the code in their inbox.
  useEffect(() => {
    const pending = readPending();
    if (pending) {
      setEmail(pending.email);
      setSentAt(pending.until - CODE_TTL_MS);
      setSent(true);
    }
  }, []);

  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);

  const resendAt = sentAt === null ? 0 : sentAt + RESEND_COOLDOWN_MS;
  const resendInMs = resendAt - now;

  // Tick only while there is a countdown to show.
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= resendAt) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [resendAt]);

  const request = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      await onRequestCode(address);
      const at = Date.now();
      setSent(true);
      setSentAt(at);
      setNow(at);
      setCode('');
      writePending({ email: address, until: at + CODE_TTL_MS });
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
    setSentAt(null);
    setCode('');
    setError('');
  };

  const activeBox = Math.min(code.length, CODE_LENGTH - 1);

  return (
    <form className={s.form} onSubmit={submit}>
      {sent ? (
        <>
          <div className={s.intro}>
            <h3>Enter the code we sent</h3>
            <p>
              A 6-digit code is on its way to <span className={s.sentTo}>{email}</span>. It expires in 10 minutes.
            </p>
          </div>

          <div className={s.codeField}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={cn(s.codeBox, codeFocused && i === activeBox && s.codeBoxActive)}
              >
                {code[i] ?? ''}
              </span>
            ))}
            <input
              ref={codeRef}
              className={s.codeInput}
              value={code}
              // Strip separators before limiting digits; maxLength would truncate a spaced paste first.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              onFocus={() => setCodeFocused(true)}
              onBlur={() => setCodeFocused(false)}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy}
              aria-label="Sign-in code"
              data-testid={`${testIdPrefix}-code-input`}
            />
          </div>

          {error && (
            <p className={s.error} role="alert" data-testid={`${testIdPrefix}-error`}>
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy || code.length !== CODE_LENGTH}
            className="h-11 w-full rounded-[10px] text-[14.5px] font-medium"
            data-testid={`${testIdPrefix}-submit`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {submitLabel}
          </Button>

          <div className={s.actions}>
            <span>
              Didn’t get it?{' '}
              <button
                type="button"
                className={s.textButton}
                onClick={() => request(email.trim())}
                disabled={busy || resendInMs > 0}
                data-testid={`${testIdPrefix}-resend`}
              >
                {resendInMs > 0 ? (
                  <>
                    Resend in <span className={s.countdown}>{formatCountdown(resendInMs)}</span>
                  </>
                ) : (
                  'Resend code'
                )}
              </button>
            </span>
            <button type="button" className={s.textButton} onClick={startOver} disabled={busy}>
              Change email
            </button>
          </div>
        </>
      ) : (
        <>
          {intro && (
            <div className={s.intro}>
              <h3>{intro.title}</h3>
              <p>{intro.description}</p>
            </div>
          )}

          <div className={s.fields}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={busy}
              aria-label="Email address"
              className="h-11 rounded-[10px] px-3.5 md:text-sm"
              data-testid={`${testIdPrefix}-email-input`}
            />

            {error && (
              <p className={s.error} role="alert" data-testid={`${testIdPrefix}-error`}>
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={busy || !email.includes('@')}
              className="h-11 w-full rounded-[10px] text-[14.5px] font-medium"
              data-testid={`${testIdPrefix}-submit`}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Send code
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
