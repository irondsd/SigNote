'use client';

import { useState } from 'react';
import { Laptop, ShieldCheck, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import s from './AuthEnrollment.module.scss';

type AuthEnrollmentProps = {
  onEnroll: (trust: boolean) => Promise<void>;
  /** Enrollment reads the server share, so it cannot happen offline. */
  online: boolean;
};

/**
 * The one moment the user agrees to a weaker boundary than Secrets and Seals
 * get. Trusting the device persists the authenticator key in this browser so
 * codes survive a restart and work offline; declining keeps the key in memory
 * for this visit only.
 *
 * The key is domain-separated from the note vault, so neither choice affects
 * how Secrets and Seals lock.
 */
export function AuthEnrollment({ onEnroll, online }: AuthEnrollmentProps) {
  const [busy, setBusy] = useState<'trust' | 'session' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (trust: boolean) => async () => {
    setBusy(trust ? 'trust' : 'session');
    setError(null);
    try {
      await onEnroll(trust);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up the authenticator');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.wrap}>
      <div className={s.icon}>
        <ShieldCheck size={30} strokeWidth={1.4} />
      </div>

      <h2 className={s.heading}>Set up the authenticator on this device</h2>
      <p className={s.sub}>
        Your codes are generated here, never on the server. To do that, this device needs a key derived from your
        encryption passphrase.
      </p>

      <ul className={s.points}>
        <li>
          <WifiOff size={15} />
          <span>
            <strong>Trusted:</strong> the key is stored in this browser, so codes keep working offline and after a
            restart. Anyone who can use this browser profile can see them.
          </span>
        </li>
        <li>
          <Laptop size={15} />
          <span>
            <strong>This visit only:</strong> the key is kept in memory and forgotten when the tab closes. Best on a
            shared or borrowed machine.
          </span>
        </li>
      </ul>

      {!online && <p className={s.offline}>Setting up needs a connection. Reconnect and try again.</p>}

      <div className={s.actions}>
        <Button onClick={run(true)} disabled={!online || busy !== null} data-testid="auth-trust-device">
          {busy === 'trust' ? 'Setting up…' : 'Trust this device'}
        </Button>
        <Button variant="outline" onClick={run(false)} disabled={!online || busy !== null}>
          {busy === 'session' ? 'Setting up…' : "Don't trust — this visit only"}
        </Button>
      </div>

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      <p className={s.footnote}>
        Either way your seeds stay encrypted on the server. You can remove this device at any time, and your passphrase
        always sets it up again.
      </p>
    </div>
  );
}
