'use client';

import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';

type NewNoteModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewNoteModal({ onClose, initialContent, onSaveError }: NewNoteModalProps) {
  const form = useNewNoteForm('note', onClose, initialContent);
  const createNote = useCreateNote({ onError: onSaveError });

  const handleSave = () => {
    const prepared = form.prepare();
    if (!prepared) return;
    form.commitDraft();
    createNote.mutate({ ...prepared, color: form.color, pattern: form.pattern, tags: form.tags });
    form.bumpTagCounts(form.tags, []);
    onClose();
  };

  return (
    <NewNoteModalShell form={form} saveLabel="Save Note" saveTestId="save-note-btn" onSave={handleSave}>
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
