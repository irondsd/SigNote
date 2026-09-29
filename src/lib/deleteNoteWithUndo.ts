import { toast } from 'sonner';

type NoteLabel = 'Note' | 'Secret' | 'Seal';

export function deleteNoteWithUndo(label: NoteLabel, onDelete: () => void, onClose: () => void, onUndo: () => void) {
  onDelete();
  onClose();
  toast.success(`${label} deleted`, {
    description: 'You can undo this action.',
    duration: 7000,
    action: {
      label: 'Undo',
      onClick: () => {
        onUndo();
        toast.success(`${label} restored`);
      },
    },
  });
}
