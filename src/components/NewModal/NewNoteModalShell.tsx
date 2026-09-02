'use client';

import { type ReactNode } from 'react';
import { X, Check } from 'lucide-react';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import type { NewNoteForm } from '@/hooks/useNewNoteForm';
import s from '@/components/NewModal/NewModal.module.scss';

type NewNoteModalShellProps = {
  form: NewNoteForm;
  /** Idle label for the save button, e.g. "Save Note". */
  saveLabel: string;
  saveTestId: string;
  onSave: () => void;
  /** When true the button shows "Saving…" and is disabled (encrypted tiers). */
  saving?: boolean;
  /** The editor surface — varies per tier (plaintext vs. encryption-wrapped). */
  children: ReactNode;
  /** Extra nodes rendered alongside the modal, e.g. a passphrase guard. */
  extras?: ReactNode;
};

/**
 * Presentational chrome shared by NewNoteModal / NewSecretModal / NewSealModal:
 * the title input, formatting toolbar, style/tag controls, footer buttons and
 * the discard-confirmation dialog. Tiers supply the editor and the save logic.
 */
export function NewNoteModalShell({
  form,
  saveLabel,
  saveTestId,
  onSave,
  saving,
  children,
  extras,
}: NewNoteModalShellProps) {
  const disableSave = (form.isTitleEmpty && form.isContentEmpty) || saving || form.isUploading;

  return (
    <>
      <NewModal
        heading={
          <input
            data-testid="note-title-input"
            className={s.heading}
            placeholder="Title"
            value={form.title}
            onChange={(e) => form.setTitle(e.target.value)}
            autoFocus
          />
        }
        onClose={form.handleClose}
        onBackdropClose={form.handleClose}
        toolbar={<FormattingToolbar editor={form.editor} isOpen={form.showFormatBar} showFileUpload />}
        footerLeft={
          <FormatToggleButton isActive={form.showFormatBar} onToggle={() => form.setShowFormatBar((v) => !v)} />
        }
        onColorChange={form.setColor}
        onPatternChange={form.setPattern}
        onTagsChange={form.setTags}
        isDirty={form.isDirty}
        footerActions={
          <>
            <Button variant="ghost" size="sm" onClick={form.handleClose}>
              <X size={14} />
              Cancel
            </Button>
            <Button data-testid={saveTestId} size="sm" onClick={onSave} disabled={disableSave}>
              <Check size={14} />
              {saving ? 'Saving…' : saveLabel}
            </Button>
          </>
        }
      >
        {children}
      </NewModal>

      {extras}

      {form.showConfirm && <ConfirmDiscardDialog onDiscard={form.handleConfirmDiscard} onCancel={form.onCancelClose} />}
    </>
  );
}
