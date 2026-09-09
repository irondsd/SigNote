'use client';

import { useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';

import { EncryptedPlaceholder, estimateLines } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { Button } from '@/components/ui/button';
import { useEncryption } from '@/contexts/EncryptionContext';
import { cn } from '@/utils/cn';
import s from './NoteContentVeil.module.scss';

type NoteContentVeilProps = {
  /** The note's ciphertext, so the cover's bar layout matches its card. */
  ciphertext?: string;
  /**
   * Whether the children are showing plaintext at all. A seal that has not been
   * decrypted yet is already rendering its own placeholder behind a "Decrypt to
   * view" button, so covering it would stack a second placeholder and a second
   * button over the first — offering "Reveal" for a body nobody has revealed.
   */
  hasPlaintext?: boolean;
  children: ReactNode;
};

/**
 * Covers an open note's plaintext for as long as the vault is locked.
 *
 * The grid swaps to placeholders the moment a soft lock fires, but a modal
 * already on screen kept rendering its decrypted body — so a tab switch hid
 * every note except the one you actually had open.
 *
 * Closing the modal instead would cost far more than it looks: soft lock fires
 * on every `document.hidden`, so an alt-tab would lose your place. And it could
 * not cover the editing case at all — closing mid-edit discards unsaved work,
 * which is exactly why the hard-lock close is guarded on `!editing`.
 *
 * A cover has neither problem. The children stay mounted, so the editor keeps
 * its buffer, but they are `visibility: hidden` and `inert`: nothing is painted
 * and nothing can be typed into them from behind the cover.
 */
export function NoteContentVeil({ ciphertext, hasPlaintext = true, children }: NoteContentVeilProps) {
  const { phase, lockType, rehydrate } = useEncryption();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const covered = hasPlaintext && phase === 'locked';

  /**
   * The same escalation the lock FAB uses: a soft lock reopens with no
   * passphrase, anything else asks for one — including a soft lock that aged
   * past HARD_LOCK_MS, which `rehydrate` itself escalates and rejects.
   */
  const reveal = async () => {
    if (lockType !== 'soft') {
      setShowPassphrase(true);
      return;
    }
    setRevealing(true);
    try {
      await rehydrate();
    } catch {
      setShowPassphrase(true);
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div className={cn(s.wrap, covered && s.wrapCovered)}>
      <div className={cn(s.content, covered && s.contentCovered)} inert={covered} aria-hidden={covered || undefined}>
        {children}
      </div>

      {covered && (
        <div className={s.veil} data-testid="note-content-veil">
          <EncryptedPlaceholder rows={ciphertext ? estimateLines(ciphertext) : 8} ciphertext={ciphertext} />
          <div className={s.revealSlot}>
            <Button
              data-testid="reveal-content-btn"
              variant="subtle-primary"
              size="sm"
              onClick={reveal}
              disabled={revealing}
            >
              <Eye size={13}  />
              {revealing ? 'Revealing…' : 'Reveal'}
            </Button>
          </div>
        </div>
      )}

      {showPassphrase && (
        <PassphraseModal onSuccess={() => setShowPassphrase(false)} onClose={() => setShowPassphrase(false)} />
      )}
    </div>
  );
}
