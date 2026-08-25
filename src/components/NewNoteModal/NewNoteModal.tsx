'use client';

import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';
import { saveDraft } from '@/lib/draft';

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
    // Persist synchronously before starting the request. In particular, this
    // covers title-only notes, which the normal typing debounce does not save.
    saveDraft({ type: 'note', ...prepared, savedAt: Date.now() });
    createNote.mutate(
      { ...prepared, color: form.color, pattern: form.pattern, tags: form.tags },
      {
        onSuccess: () => {
          form.commitDraft();
          form.bumpTagCounts(form.tags, []);
          onClose();
        },
      },
    );
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
