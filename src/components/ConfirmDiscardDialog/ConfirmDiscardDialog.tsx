'use client';

import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import s from './ConfirmDiscardDialog.module.scss';

type ConfirmDiscardDialogProps = {
  onDiscard: () => void;
  onCancel: () => void;
};

export function ConfirmDiscardDialog({ onDiscard, onCancel }: ConfirmDiscardDialogProps) {
  return (
    <Backdrop onClose={onCancel} className={s.backdrop}>
      <Modal className={s.modal}>
        <h2 className={s.heading}>Discard unsaved changes?</h2>
        <p className={s.body}>Your changes have not been saved and will be lost.</p>
        <div className={s.actions}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </Modal>
    </Backdrop>
  );
}
