'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';
import { saveDraft } from '@/lib/draft';

type NewSecretModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewSecretModal({ onClose, initialContent, onSaveError }: NewSecretModalProps) {
  const guard = useSimpleEncryptionGuard();
  const { mek } = useEncryption();
  const [saving, setSaving] = useState(false);
  const pendingRecoveryRef = useRef<{ title: string; content: string } | null>(null);
  const form = useNewNoteForm('secret', onClose, initialContent);

  const createSecret = useCreateSecret({
    onError: () => {
      if (pendingRecoveryRef.current) onSaveError?.(pendingRecoveryRef.current);
    },
  });

  const handleSave = async () => {
    const prepared = form.prepare();
    if (!prepared) return;
    saveDraft({ type: 'secret', ...prepared, savedAt: Date.now() });

    try {
      setSaving(true);
      await guard.execute(async (mek) => {
        const encryptedBody = prepared.content ? await encryptSecretBody(mek, prepared.content) : null;
        pendingRecoveryRef.current = prepared;
        const fileIds = extractFileIds(prepared.content);
        createSecret.mutate(
          {
            title: prepared.title,
            encryptedBody,
            color: form.color,
            pattern: form.pattern,
            fileIds,
            tags: form.tags,
          },
          {
            onSuccess: () => {
              form.commitDraft();
              form.bumpTagCounts(form.tags, []);
              onClose();
            },
          },
        );
      });
    } catch {
      toast.error('Failed to prepare secret for saving', { description: 'Your draft is safe.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <NewNoteModalShell
      form={form}
      saveLabel="Save Secret"
      saveTestId="save-secret-btn"
      onSave={handleSave}
      saving={saving || createSecret.isPending}
      extras={guard.PassphraseGuard}
    >
      <FileEncryptionProvider mek={mek}>
        <TiptapEditor
          content={form.content}
          onChange={form.setContent}
          editable={true}
          placeholder="Write your secret…"
          onEditorReady={form.setEditor}
          allowFileUpload
          onUploadingChange={form.setIsUploading}
          fileEncryptionCtx={mek ? { mek } : undefined}
          requiresEncryption
        />
      </FileEncryptionProvider>
    </NewNoteModalShell>
  );
}
