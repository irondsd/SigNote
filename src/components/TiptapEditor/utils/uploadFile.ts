import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/zip',
]);

function isImageMime(mime: string) {
  return mime.startsWith('image/');
}

export async function uploadFileToEditor(editor: Editor, file: File) {
  if (file.size > MAX_FILE_SIZE) {
    toast.error(`File "${file.name}" exceeds 5 MB limit`);
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    toast.error(`File type "${file.type || 'unknown'}" is not allowed`);
    return;
  }

  const nodeType = isImageMime(file.type) ? 'imageAttachment' : 'fileAttachment';

  const attrs = {
    fileId: null,
    filename: file.name,
    size: file.size,
    mimeType: file.type,
    uploadStatus: 'uploading',
  };

  editor.chain().focus().insertContent({ type: nodeType, attrs }).run();

  const storage = editor.extensionManager.extensions.find((e) => e.name === 'fileDropHandler')
    ?.storage as Record<string, number> | undefined;
  if (storage) {
    storage.fileUploadCounter = (storage.fileUploadCounter || 0) + 1;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/files', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }

    const data = await res.json();

    const { state, view } = editor;
    let targetPos: number | null = null;
    state.doc.descendants((n, p) => {
      if (
        targetPos === null &&
        n.type.name === nodeType &&
        n.attrs.filename === file.name &&
        n.attrs.uploadStatus === 'uploading' &&
        n.attrs.size === file.size
      ) {
        targetPos = p;
      }
    });

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

    const { state, view } = editor;
    let targetPos: number | null = null;
    state.doc.descendants((n, p) => {
      if (
        targetPos === null &&
        n.type.name === nodeType &&
        n.attrs.filename === file.name &&
        n.attrs.uploadStatus === 'uploading' &&
        n.attrs.size === file.size
      ) {
        targetPos = p;
      }
    });

    if (targetPos !== null) {
      const nodeAtPos = editor.state.doc.nodeAt(targetPos);
      if (nodeAtPos) {
        const tr = view.state.tr.delete(targetPos, targetPos + nodeAtPos.nodeSize);
        view.dispatch(tr);
      }
    }
  } finally {
    if (storage) {
      storage.fileUploadCounter = Math.max(0, (storage.fileUploadCounter || 1) - 1);
    }
  }
}
