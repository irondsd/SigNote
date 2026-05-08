import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const UPLOAD_COUNTER_KEY = 'fileUploadCounter';

export const FileDropHandler = Extension.create({
  name: 'fileDropHandler',

  addStorage() {
    return {
      [UPLOAD_COUNTER_KEY]: 0,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as Record<string, number>;

    return [
      new Plugin({
        key: new PluginKey('fileDropHandler'),
        props: {
          handleDrop(view: EditorView, event: DragEvent) {
            if (!event.dataTransfer?.files.length) return false;

            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (pos == null) return false;

            const files = Array.from(event.dataTransfer.files);
            for (const file of files) {
              insertAndUploadFile(view, file, pos, storage);
            }
            return true;
          },

          handlePaste(view: EditorView, event: ClipboardEvent) {
            const items = event.clipboardData?.items;
            if (!items) return false;

            const files: File[] = [];
            for (const item of Array.from(items)) {
              if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) files.push(file);
              }
            }

            if (!files.length) return false;
            event.preventDefault();

            const pos = view.state.selection.from;
            for (const file of files) {
              insertAndUploadFile(view, file, pos, storage);
            }
            return true;
          },
        },
      }),
    ];
  },
});

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

async function insertAndUploadFile(
  view: EditorView,
  file: File,
  pos: number,
  storage: Record<string, number>,
) {
  const { toast } = await import('sonner');

  if (file.size > MAX_FILE_SIZE) {
    toast.error(`File "${file.name}" exceeds 5 MB limit`);
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    toast.error(`File type "${file.type || 'unknown'}" is not allowed`);
    return;
  }

  const nodeType = isImageMime(file.type) ? 'imageAttachment' : 'fileAttachment';
  const schema = view.state.schema;
  const nodeTypeObj = schema.nodes[nodeType];
  if (!nodeTypeObj) return;

  const attrs = {
    fileId: null,
    filename: file.name,
    size: file.size,
    mimeType: file.type,
    uploadStatus: 'uploading',
  };

  const node = nodeTypeObj.create(attrs);
  const insertPos = Math.min(pos, view.state.doc.content.size);
  let tr = view.state.tr.insert(insertPos, node);
  view.dispatch(tr);

  storage[UPLOAD_COUNTER_KEY] = (storage[UPLOAD_COUNTER_KEY] || 0) + 1;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/files', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }

    const data = await res.json();

    const { state } = view;
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
      tr = view.state.tr.setNodeMarkup(targetPos, undefined, {
        ...attrs,
        fileId: data.fileId,
        uploadStatus: 'complete',
      });
      view.dispatch(tr);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    toast.error(message);

    const { state } = view;
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
      const nodeAtPos = view.state.doc.nodeAt(targetPos);
      if (nodeAtPos) {
        tr = view.state.tr.delete(targetPos, targetPos + nodeAtPos.nodeSize);
        view.dispatch(tr);
      }
    }
  } finally {
    storage[UPLOAD_COUNTER_KEY] = Math.max(0, (storage[UPLOAD_COUNTER_KEY] || 1) - 1);
  }
}
