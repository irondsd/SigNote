'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OtpSecrets } from '@/lib/otp/record';
import s from './AuthDialogs.module.scss';

type EditAuthDialogProps = {
  secrets: OtpSecrets;
  onSave: (next: OtpSecrets) => Promise<void>;
  onClose: () => void;
};

/**
 * Renames only. The seed and its parameters are never editable after creation —
 * changing them in place would silently break the credential with no way back,
 * and there is no reason to: a re-issued seed is a new credential.
 */
export function EditAuthDialog({ secrets, onSave, onClose }: EditAuthDialogProps) {
  const [issuer, setIssuer] = useState(secrets.issuer);
  const [account, setAccount] = useState(secrets.account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...secrets, issuer: issuer.trim(), account: account.trim() });
      onClose();
    } catch {
      setError('Could not save the change');
      setBusy(false);
    }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="ph-no-capture" onClick={(e) => e.stopPropagation()}>
        <Modal className={s.modal}>
          <header className={s.header}>
            <h2 className={s.heading}>Edit credential</h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          </header>

          <div className={s.body}>
            <Label htmlFor="edit-issuer">Service</Label>
            <Input id="edit-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} autoComplete="off" />

            <Label htmlFor="edit-account">Account</Label>
            <Input id="edit-account" value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="off" />

            <p className={s.note}>The setup key and its settings cannot be changed. Add a new credential instead.</p>

            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
          </div>

          <footer className={s.footer}>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              Save
            </Button>
          </footer>
        </Modal>
      </div>
    </Backdrop>
  );
}
