'use client';

import { useState } from 'react';
import { Check, Copy, Eye, EyeOff, TriangleAlert, X } from 'lucide-react';

import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEncryption } from '@/contexts/EncryptionContext';
import useCopy from '@/hooks/useCopy';
import { buildOtpUri } from '@/lib/otp/uri';
import type { OtpSecrets } from '@/lib/otp/record';
import s from './AuthDialogs.module.scss';

type ExportAuthDialogProps = {
  secrets: OtpSecrets;
  onClose: () => void;
};

/**
 * The only place a seed is ever shown again after creation, and only behind an
 * explicit confirmation — the exported link *is* the credential, so anyone who
 * reads it owns the second factor.
 */
export function ExportAuthDialog({ secrets, onClose }: ExportAuthDialogProps) {
  const [revealed, setRevealed] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { verifyPassphrase } = useEncryption();
  const uri = buildOtpUri(secrets);
  const { isCopied, copy } = useCopy(uri);

  const reveal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passphrase.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      await verifyPassphrase(passphrase);
      setPassphrase('');
      setRevealed(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'Incorrect passphrase'
          ? 'Incorrect passphrase. Try again.'
          : 'Could not verify your passphrase. Check your connection and try again.',
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="ph-no-capture" onClick={(e) => e.stopPropagation()}>
        <Modal className={s.modal}>
          <header className={s.header}>
            <h2 className={s.heading}>Export credential</h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          </header>

          <div className={s.body}>
            <div className={s.warning}>
              <TriangleAlert size={16} />
              <p>
                This link contains the secret for <strong>{secrets.issuer || secrets.account}</strong>. Anyone who has
                it can generate your codes. Do not paste it into chat, email or a screenshot.
              </p>
            </div>

            {revealed ? (
              <>
                <code className={s.uri} data-testid="auth-export-uri">
                  {uri}
                </code>
                <Button variant="outline" onClick={() => void copy()}>
                  {isCopied ? <Check size={15} /> : <Copy size={15} />}
                  {isCopied ? 'Copied' : 'Copy link'}
                </Button>
              </>
            ) : (
              <form className={s.verifyForm} onSubmit={(event) => void reveal(event)}>
                <Label htmlFor="auth-export-passphrase">Encryption passphrase</Label>
                <p className={s.note}>Re-enter your passphrase before revealing the permanent setup key.</p>
                <div className={s.passphraseWrap}>
                  <Input
                    id="auth-export-passphrase"
                    type={showPassphrase ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Your passphrase"
                    value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    disabled={verifying}
                    autoFocus
                    className={s.passphraseInput}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={s.passphraseToggle}
                    onClick={() => setShowPassphrase((shown) => !shown)}
                    tabIndex={-1}
                    aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  >
                    {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" variant="destructive" disabled={verifying || !passphrase.trim()}>
                  {verifying ? 'Verifying…' : 'Reveal the setup link'}
                </Button>
              </form>
            )}
          </div>
        </Modal>
      </div>
    </Backdrop>
  );
}
