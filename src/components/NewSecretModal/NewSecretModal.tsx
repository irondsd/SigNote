'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useRehydratingEncryptionAction } from '@/hooks/useRehydratingEncryptionAction';
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
  const { mek, phase, lockType, rehydrate } = useEncryption();
  const [saving, setSaving] = useState(false);
  const form = useNewNoteForm('secret', onClose, initialContent, mek);
  const preparedRef = useRef<NonNullable<ReturnType<typeof form.prepare>> | null>(null);
  const { color, pattern, save, tags } = form;

  const createSecret = useCreateSecret();

  const savePrepared = useCallback(
    async (currentMek: CryptoKey) => {
      const prepared = preparedRef.current;
      if (!prepared) return;
      preparedRef.current = null;

      try {
        const encryptedBody = prepared.content ? await encryptSecretBody(currentMek, prepared.content) : null;
        const fileIds = extractFileIds(prepared.content);
        save(
          () =>
            createSecret.mutateAsync({
              title: prepared.title,
              encryptedBody,
              color,
              pattern,
              fileIds,
              tags,
            }),
          { showProgress: fileIds.length > 0 },
        );
        onClose();
      } catch {
        toast.error('Failed to prepare secret for saving', { description: 'Your draft is safe.' });
      }
    },
    [color, createSecret, onClose, pattern, save, tags],
  );
  const actions = useMemo(() => ({ save: savePrepared }), [savePrepared]);
  const runProtectedAction = useRehydratingEncryptionAction({
    mek,
    lockType,
    rehydrate,
    execute: guard.execute,
    actions,
  });

  const handleSave = async () => {
    const prepared = form.prepare();
    if (!prepared) return;
    form.recovery.flush();

    preparedRef.current = prepared;
    try {
      setSaving(true);
      await runProtectedAction('save');
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
