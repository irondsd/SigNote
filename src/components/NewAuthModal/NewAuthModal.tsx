'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageDown, KeyRound, Link2, X } from 'lucide-react';
import { toast } from 'sonner';
import posthog from 'posthog-js';

import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Base32Error, decodeBase32, isWeakSecret } from '@/lib/otp/base32';
import { decodeQrFromBlob, imageFromClipboard } from '@/lib/otp/qr';
import { isSameCredential, toOtpSecrets, type OtpSecrets } from '@/lib/otp/record';
import { OTP_ALGORITHMS, OTP_DIGITS, type OtpAlgorithm, type OtpDigits } from '@/lib/otp/totp';
import { OtpUriError, parseOtpUri } from '@/lib/otp/uri';
import { useOtpVault } from '@/contexts/OtpVaultContext';
import { QrScanner } from './QrScanner';
import s from './NewAuthModal.module.scss';

type Mode = 'scan' | 'image' | 'uri' | 'manual';

/**
 * Touch-primary devices get the camera; everything else gets the image, link
 * and manual paths. The desktop shell (Electron) denies camera permission
 * outright, so the image path is the one that always works there.
 */
const prefersCamera = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Constant text only — a parse error must never quote the URI or the seed. */
function messageFor(err: unknown): string {
  if (err instanceof OtpUriError || err instanceof Base32Error) return err.message;
  return 'That credential could not be read';
}

type NewAuthModalProps = {
  onClose: () => void;
};

export function NewAuthModal({ onClose }: NewAuthModalProps) {
  const { create, records } = useOtpVault();
  const [mode, setMode] = useState<Mode>(() => (prefersCamera() ? 'scan' : 'image'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [uri, setUri] = useState('');
  const [issuer, setIssuer] = useState('');
  const [account, setAccount] = useState('');
  const [secret, setSecret] = useState('');
  const [algorithm, setAlgorithm] = useState<OtpAlgorithm>('SHA1');
  const [digits, setDigits] = useState<OtpDigits>(6);
  const [period, setPeriod] = useState(30);

  const save = useCallback(
    async (secrets: OtpSecrets, method: Mode) => {
      const duplicate = records.find((r) => r.secrets && isSameCredential(r.secrets, secrets));
      if (duplicate) {
        setError('You already have this credential');
        return;
      }
      setBusy(true);
      try {
        await create({ secrets });
        // Shape only: never the issuer, the account or the seed.
        posthog.capture('otp_record_added', { method });
        toast.success('Credential added');
        onClose();
      } catch {
        setError('Could not save the credential. Check your connection and try again.');
      } finally {
        setBusy(false);
      }
    },
    [create, records, onClose],
  );

  const acceptUri = useCallback(
    async (text: string, method: Mode) => {
      setError(null);
      try {
        const parsed = parseOtpUri(text);
        await save(
          toOtpSecrets({
            issuer: parsed.issuer,
            account: parsed.account,
            secret: parsed.secret,
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period,
          }),
          method,
        );
      } catch (err) {
        setError(messageFor(err));
      }
    },
    [save],
  );

  const acceptImage = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      try {
        const text = await decodeQrFromBlob(file);
        if (!text) {
          setError('No QR code was found in that image');
          return;
        }
        await acceptUri(text, 'image');
      } catch {
        setError('That image could not be read');
      } finally {
        setBusy(false);
      }
    },
    [acceptUri],
  );

  const acceptScan = useCallback((text: string) => void acceptUri(text, 'scan'), [acceptUri]);

  // A screenshot on the clipboard is the most common way a QR code exists on a
  // desktop, so paste works anywhere in the modal rather than only in a field.
  useEffect(() => {
    if (mode !== 'image') return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e.clipboardData?.items ?? null);
      if (file) {
        e.preventDefault();
        void acceptImage(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [mode, acceptImage]);

  const submitManual = async () => {
    setError(null);
    try {
      const bytes = decodeBase32(secret);
      const secrets = toOtpSecrets({ issuer, account, secret, algorithm, digits, period });
      if (isWeakSecret(bytes)) {
        // Common in the wild and still usable — worth a warning, not a refusal.
        toast.warning('That setup key is shorter than recommended, but it will work.');
      }
      await save(secrets, 'manual');
    } catch (err) {
      setError(messageFor(err));
    }
  };

  const TABS: { id: Mode; label: string; icon: React.ReactNode }[] = [
    { id: 'scan', label: 'Camera', icon: <Camera size={15} /> },
    { id: 'image', label: 'QR image', icon: <ImageDown size={15} /> },
    { id: 'uri', label: 'Paste link', icon: <Link2 size={15} /> },
    { id: 'manual', label: 'By hand', icon: <KeyRound size={15} /> },
  ];

  return (
    <Backdrop onClose={onClose}>
      {/* ph-no-capture: autocapture sends the text content of clicked elements,
          which here would mean issuers, accounts and seeds. */}
      <div className="ph-no-capture" onClick={(e) => e.stopPropagation()}>
        <Modal className={s.modal}>
          <header className={s.header}>
            <h2 className={s.heading}>Add authenticator</h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          </header>

          <div className={s.tabs} role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                className={s.tab}
                data-active={mode === tab.id || undefined}
                onClick={() => {
                  setMode(tab.id);
                  setError(null);
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className={s.body}>
            {mode === 'scan' && <QrScanner onResult={acceptScan} />}

            {mode === 'image' && (
              <div
                className={s.dropzone}
                data-dragging={dragging || undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void acceptImage(file);
                }}
              >
                <ImageDown size={30} strokeWidth={1.3} />
                <p className={s.dropTitle}>Drop a QR image, or paste a screenshot</p>
                <p className={s.dropHint}>The image is decoded on this device and never uploaded.</p>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                  Choose an image
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void acceptImage(file);
                    e.target.value = '';
                  }}
                />
              </div>
            )}

            {mode === 'uri' && (
              <div className={s.form}>
                <Label htmlFor="otp-uri">Setup link</Label>
                <Input
                  id="otp-uri"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="otpauth://totp/..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button onClick={() => void acceptUri(uri, 'uri')} disabled={busy || !uri.trim()}>
                  Add credential
                </Button>
              </div>
            )}

            {mode === 'manual' && (
              <div className={s.form}>
                <div className={s.row}>
                  <div className={s.field}>
                    <Label htmlFor="otp-issuer">Service</Label>
                    <Input
                      id="otp-issuer"
                      value={issuer}
                      onChange={(e) => setIssuer(e.target.value)}
                      placeholder="GitHub"
                      autoComplete="off"
                    />
                  </div>
                  <div className={s.field}>
                    <Label htmlFor="otp-account">Account</Label>
                    <Input
                      id="otp-account"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <Label htmlFor="otp-secret">Setup key</Label>
                <Input
                  id="otp-secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="JBSW Y3DP EHPK 3PXP"
                  autoComplete="off"
                  spellCheck={false}
                  className={s.mono}
                />

                <details className={s.advanced}>
                  <summary>Advanced</summary>
                  <div className={s.row}>
                    <div className={s.field}>
                      <Label htmlFor="otp-algorithm">Algorithm</Label>
                      <select
                        id="otp-algorithm"
                        className={s.select}
                        value={algorithm}
                        onChange={(e) => setAlgorithm(e.target.value as OtpAlgorithm)}
                      >
                        {OTP_ALGORITHMS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={s.field}>
                      <Label htmlFor="otp-digits">Digits</Label>
                      <select
                        id="otp-digits"
                        className={s.select}
                        value={digits}
                        onChange={(e) => setDigits(Number(e.target.value) as OtpDigits)}
                      >
                        {OTP_DIGITS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={s.field}>
                      <Label htmlFor="otp-period">Period</Label>
                      <Input
                        id="otp-period"
                        type="number"
                        min={1}
                        max={3600}
                        value={period}
                        onChange={(e) => setPeriod(Number(e.target.value))}
                      />
                    </div>
                  </div>
                </details>

                <Button onClick={() => void submitManual()} disabled={busy || !secret.trim()}>
                  Add credential
                </Button>
              </div>
            )}

            {error && (
              <p className={s.error} role="alert" data-testid="auth-error">
                {error}
              </p>
            )}
          </div>
        </Modal>
      </div>
    </Backdrop>
  );
}
