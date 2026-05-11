import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { UPLOAD_COUNTER_KEY } from '@/config/fileConstants';
import { validateFile, getNodeType, makeAttrs, uploadAndUpdateNode } from './uploadCore';

export type FileEncryptionContext = {
  mek: CryptoKey;
};

export async function uploadFileToEditor(editor: Editor, file: File, encryptionCtx?: FileEncryptionContext) {
  const error = validateFile(file);
  if (error) {
    toast.error(error);
    return;
  }

  const nodeType = getNodeType(file);
  const attrs = makeAttrs(file);

  editor.chain().focus().insertContent({ type: nodeType, attrs }).run();

  const storage = (editor.extensionManager.extensions.find((e) => e.name === 'fileDropHandler')?.storage ?? {
    [UPLOAD_COUNTER_KEY]: 0,
  }) as Record<string, unknown>;

  await uploadAndUpdateNode(editor.view, file, nodeType, attrs, storage, encryptionCtx);
}
