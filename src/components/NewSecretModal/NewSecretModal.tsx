'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NoteContentVeil } from '@/components/NoteContentVeil/NoteContentVeil';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';
import type { DraftContent } from '@/lib/draft';

type NewSecretModalProps = {
  onClose: () => void;
  initialContent?: DraftContent;
};

export function NewSecretModal({ onClose, initialContent }: NewSecretModalProps) {
  const guard = useSimpleEncryptionGuard();
  const { mek, phase } = useEncryption();
  const [saving, setSaving] = useState(false);
  const form = useNewNoteForm('secret', onClose, initialContent, mek);

  const createSecret = useCreateSecret();

  const handleSave = async () => {
    const prepared = form.prepare();
    if (!prepared) return;
    form.recovery.flush();

    try {
      setSaving(true);
      await guard.execute(async (mek) => {
        const encryptedBody = prepared.content ? await encryptSecretBody(mek, prepared.content) : null;
        const fileIds = extractFileIds(prepared.content);
        form.save(() =>
          createSecret.mutateAsync({
            title: prepared.title,
            encryptedBody,
            color: form.color,
            pattern: form.pattern,
            fileIds,
            tags: form.tags,
          }),
        );
        onClose();
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
      contentLocked={phase === 'locked'}
      extras={guard.PassphraseGuard}
    >
      <NoteContentVeil>
        <FileEncryptionProvider mek={mek}>
          <TiptapEditor
            content={form.content}
            onChange={form.setContent}
            editable={phase !== 'locked'}
            placeholder="Write your secret…"
            onEditorReady={form.setEditor}
            allowFileUpload
            onUploadingChange={form.setIsUploading}
            fileEncryptionCtx={mek ? { mek } : undefined}
            requiresEncryption
          />
        </FileEncryptionProvider>
      </NoteContentVeil>
    </NewNoteModalShell>
  );
}
