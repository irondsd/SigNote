'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { v7 as uuidv7 } from 'uuid';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useSealKeys } from '@/hooks/useSealKeys';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSealBody, encryptSealBodyWithExistingKey } from '@/lib/crypto';
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
  // The Seal's id and key exist before the Seal does, so attachments can be
  // encrypted under the key it will be saved with. A recovered draft keeps both.
  const [sealId] = useState(() => initialContent?.sealKey?.id ?? uuidv7());
  const sealKeys = useSealKeys(sealId, initialContent?.sealKey?.wrappedNoteKey ?? null, mek);
  const sealKey = sealKeys.wrappedNoteKey ? { id: sealId, wrappedNoteKey: sealKeys.wrappedNoteKey } : undefined;
  const form = useNewNoteForm('seal', onClose, initialContent, mek, sealKey);

  const createSeal = useCreateSeal();

  const handleSave = async () => {
    const prepared = form.prepare();
    if (!prepared) return;
    form.recovery.flush();

    try {
      setSaving(true);
      await guard.execute(async (mek) => {
        const fileIds = extractFileIds(prepared.content);
        const wrappedNoteKey = sealKeys.wrappedNoteKey;
        // Always shown: encrypting and saving a seal is never instant.
        form.save(
          () =>
            createSeal.mutateAsync({
              // With a minted key the Seal is created under that id, so the
              // attachments already under its key link to it.
              ...(wrappedNoteKey && { id: sealId }),
              title: prepared.title,
              color: form.color,
              pattern: form.pattern,
              fileIds,
              tags: form.tags,
              encryptBody: async (id: string) => {
                if (!prepared.content) return null;
                return wrappedNoteKey
                  ? encryptSealBodyWithExistingKey(mek, prepared.content, id, wrappedNoteKey)
                  : encryptSealBody(mek, prepared.content, id);
              },
            }),
          { showProgress: true },
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
        <FileEncryptionProvider mek={mek} seal={{ id: sealId, noteKey: sealKeys.noteKey }}>
          <TiptapEditor
            content={form.content}
            onChange={form.setContent}
            editable={phase !== 'locked'}
            placeholder="Write your seal…"
            onEditorReady={form.setEditor}
            allowFileUpload
            onUploadingChange={form.setIsUploading}
            fileEncryptionCtx={sealKeys.noteKey ? { sealId, noteKey: sealKeys.noteKey } : undefined}
            requiresEncryption
            sealId={sealId}
          />
        </FileEncryptionProvider>
      </NoteContentVeil>
    </NewNoteModalShell>
  );
}
