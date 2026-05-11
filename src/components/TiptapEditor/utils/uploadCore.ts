import type { EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { MAX_FILE_SIZE, ALLOWED_MIME_TYPES, isImageMime, UPLOAD_COUNTER_KEY } from '@/config/fileConstants';
import type { FileEncryptionContext } from './uploadFile';

export function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return `File "${file.name}" exceeds 5 MB limit`;
  if (!ALLOWED_MIME_TYPES.has(file.type)) return `File type "${file.type || 'unknown'}" is not allowed`;
  return null;
}

export function getNodeType(file: File) {
  return isImageMime(file.type) ? 'imageAttachment' : 'fileAttachment';
}

export function makeAttrs(file: File) {
  return {
    fileId: null,
    filename: file.name,
    size: file.size,
    mimeType: file.type,
    uploadStatus: 'uploading',
  };
}

export function findUploadingNode(state: EditorState, nodeType: string, filename: string, size: number): number | null {
  let targetPos: number | null = null;
  state.doc.descendants((n, p) => {
    if (
      targetPos === null &&
      n.type.name === nodeType &&
      n.attrs.filename === filename &&
      n.attrs.uploadStatus === 'uploading' &&
      n.attrs.size === size
    ) {
      targetPos = p;
    }
  });
  return targetPos;
}

async function buildFormData(file: File, encryptionCtx?: FileEncryptionContext): Promise<FormData> {
  const formData = new FormData();
  if (encryptionCtx) {
    const { encryptFileBytes } = await import('@/lib/crypto');
    const plainBytes = new Uint8Array(await file.arrayBuffer());
    const { iv, cipherBytes } = await encryptFileBytes(encryptionCtx.mek, plainBytes);
    formData.append('file', new Blob([cipherBytes]), file.name);
    formData.append('originalMimeType', file.type);
    formData.append('originalSize', String(file.size));
    formData.append('encrypted', 'true');
    formData.append('encryptionIv', iv);
  } else {
    formData.append('file', file);
  }
  return formData;
}

export async function uploadAndUpdateNode(
  view: EditorView,
  file: File,
  nodeType: string,
  attrs: ReturnType<typeof makeAttrs>,
  storage: Record<string, unknown>,
  encryptionCtx?: FileEncryptionContext,
) {
  storage[UPLOAD_COUNTER_KEY] = ((storage[UPLOAD_COUNTER_KEY] as number) || 0) + 1;

  try {
    const formData = await buildFormData(file, encryptionCtx);

    const res = await fetch('/api/files', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }

    const data = await res.json();
    const targetPos = findUploadingNode(view.state, nodeType, file.name, file.size);

    if (targetPos !== null) {
      const tr = view.state.tr.setNodeMarkup(targetPos, undefined, {
        ...attrs,
        fileId: data.fileId,
        uploadStatus: 'complete',
      });
      view.dispatch(tr);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    toast.error(message);

    const targetPos = findUploadingNode(view.state, nodeType, file.name, file.size);
    if (targetPos !== null) {
      const nodeAtPos = view.state.doc.nodeAt(targetPos);
      if (nodeAtPos) {
        const tr = view.state.tr.delete(targetPos, targetPos + nodeAtPos.nodeSize);
        view.dispatch(tr);
      }
    }
  } finally {
    storage[UPLOAD_COUNTER_KEY] = Math.max(0, ((storage[UPLOAD_COUNTER_KEY] as number) || 1) - 1);
  }
}
