'use client';

import { useState } from 'react';
import { Check, Copy, TriangleAlert, X } from 'lucide-react';

import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { Button } from '@/components/ui/button';
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
  const uri = buildOtpUri(secrets);
  const { isCopied, copy } = useCopy(uri);

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
              <Button variant="destructive" onClick={() => setRevealed(true)}>
                Reveal the setup link
              </Button>
            )}
          </div>
        </Modal>
      </div>
    </Backdrop>
  );
}
