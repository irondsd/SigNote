'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSealBody } from '@/lib/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { NoteContentVeil } from '@/components/NoteContentVeil/NoteContentVeil';
import { NewNoteModalShell } from '@/components/NewModal/NewNoteModalShell';
import { useNewNoteForm } from '@/hooks/useNewNoteForm';
import type { DraftContent } from '@/lib/draft';

type NewSealModalProps = {
  onClose: () => void;
  initialContent?: DraftContent;
};

export function NewSealModal({ onClose, initialContent }: NewSealModalProps) {
  const guard = useSimpleEncryptionGuard();
  const { mek, phase } = useEncryption();
  const [saving, setSaving] = useState(false);
  const form = useNewNoteForm('seal', onClose, initialContent, mek);

  const createSeal = useCreateSeal();

  const handleSave = async () => {
    const prepared = form.prepare();
    if (!prepared) return;
    form.recovery.flush();

    try {
      setSaving(true);
      await guard.execute(async (mek) => {
        const fileIds = extractFileIds(prepared.content);
        form.save(() =>
          createSeal.mutateAsync({
            title: prepared.title,
            color: form.color,
            pattern: form.pattern,
            fileIds,
            tags: form.tags,
            encryptBody: async (sealId: string) => {
              if (!prepared.content) return null;
              return encryptSealBody(mek, prepared.content, sealId);
            },
          }),
        );
        onClose();
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
      contentLocked={phase === 'locked'}
      extras={guard.PassphraseGuard}
    >
      <NoteContentVeil>
        <FileEncryptionProvider mek={mek}>
          <TiptapEditor
            content={form.content}
            onChange={form.setContent}
            editable={phase !== 'locked'}
            placeholder="Write your seal…"
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
