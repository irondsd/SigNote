'use client';

import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';
import type { DraftContent } from '@/lib/draft';

type NewNoteModalProps = {
  onClose: () => void;
  initialContent?: DraftContent;
};

export function NewNoteModal({ onClose, initialContent }: NewNoteModalProps) {
  const form = useNewNoteForm('note', onClose, initialContent);
  const createNote = useCreateNote();

  const handleSave = () => {
    const prepared = form.prepare();
    if (!prepared) return;
    form.save(() => createNote.mutateAsync({ ...prepared, color: form.color, pattern: form.pattern, tags: form.tags }));
    onClose();
  };

  return (
    <NewNoteModalShell
      form={form}
      saveLabel="Save Note"
      saveTestId="save-note-btn"
      onSave={handleSave}
      saving={createNote.isPending}
    >
      <TiptapEditor
        content={form.content}
        onChange={form.setContent}
        editable={true}
        placeholder="Write your note..."
        onEditorReady={form.setEditor}
        allowFileUpload
        onUploadingChange={form.setIsUploading}
      />
    </NewNoteModalShell>
  );
}
