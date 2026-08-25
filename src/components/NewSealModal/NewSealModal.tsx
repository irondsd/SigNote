'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSealBody } from '@/lib/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';
import { saveDraft } from '@/lib/draft';

type NewSealModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewSealModal({ onClose, initialContent, onSaveError }: NewSealModalProps) {
  const guard = useSimpleEncryptionGuard();
  const { mek } = useEncryption();
  const [saving, setSaving] = useState(false);
  const pendingRecoveryRef = useRef<{ title: string; content: string } | null>(null);
  const form = useNewNoteForm('seal', onClose, initialContent);

  const createSeal = useCreateSeal({
    onError: () => {
      if (pendingRecoveryRef.current) onSaveError?.(pendingRecoveryRef.current);
    },
  });

  const handleSave = async () => {
    const prepared = form.prepare();
    if (!prepared) return;
    saveDraft({ type: 'seal', ...prepared, savedAt: Date.now() });

    try {
      setSaving(true);
      await guard.execute(async (mek) => {
        pendingRecoveryRef.current = prepared;
        const fileIds = extractFileIds(prepared.content);
        createSeal.mutate(
          {
            title: prepared.title,
            color: form.color,
            pattern: form.pattern,
            fileIds,
            tags: form.tags,
            encryptBody: async (sealId: string) => {
              if (!prepared.content) return null;
              return encryptSealBody(mek, prepared.content, sealId);
            },
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
      toast.error('Failed to prepare seal for saving', { description: 'Your draft is safe.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <NewNoteModalShell
      form={form}
      saveLabel="Save Seal"
      saveTestId="save-seal-btn"
      onSave={handleSave}
      saving={saving || createSeal.isPending}
      extras={guard.PassphraseGuard}
    >
      <FileEncryptionProvider mek={mek}>
        <TiptapEditor
          content={form.content}
          onChange={form.setContent}
          editable={true}
          placeholder="Write your seal…"
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
