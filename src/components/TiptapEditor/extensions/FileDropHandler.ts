import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { FileEncryptionContext } from '../utils/uploadFile';
import { UPLOAD_COUNTER_KEY } from '@/config/fileConstants';
import { validateFile, getNodeType, makeAttrs, uploadAndUpdateNode } from '../utils/uploadCore';

export type EncryptionRef = { current: { ctx: FileEncryptionContext | undefined; required: boolean } };

export const FileDropHandler = Extension.create<{ encryptionRef?: EncryptionRef }>({
  name: 'fileDropHandler',

  addOptions() {
    return { encryptionRef: undefined };
  },

  addStorage() {
    return {
      [UPLOAD_COUNTER_KEY]: 0,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as Record<string, unknown>;
    const encryptionRef = this.options.encryptionRef;

    return [
      new Plugin({
        key: new PluginKey('fileDropHandler'),
        props: {
          handleDrop(view: EditorView, event: DragEvent) {
            if (!view.editable) return false;
            if (!event.dataTransfer?.files.length) return false;

            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (pos == null) return false;

            const enc = encryptionRef?.current;
            const files = Array.from(event.dataTransfer.files);
            for (const file of files) {
              insertAndUploadFile(view, file, pos, storage, enc?.ctx, enc?.required);
            }
            return true;
          },

          handlePaste(view: EditorView, event: ClipboardEvent) {
            if (!view.editable) return false;
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

            const enc = encryptionRef?.current;
            const pos = view.state.selection.from;
            for (const file of files) {
              insertAndUploadFile(view, file, pos, storage, enc?.ctx, enc?.required);
            }
            return true;
          },
        },
      }),
    ];
  },
});

async function insertAndUploadFile(
  view: EditorView,
  file: File,
  pos: number,
  storage: Record<string, unknown>,
  encryptionCtx?: FileEncryptionContext,
  requiresEncryption?: boolean,
) {
  const { toast } = await import('sonner');

  if (requiresEncryption && !encryptionCtx) {
    toast.error('Unlock required to attach files');
    return;
  }

  const error = validateFile(file);
  if (error) {
    toast.error(error);
    return;
  }

  const nodeType = getNodeType(file);
  const nodeTypeObj = view.state.schema.nodes[nodeType];
  if (!nodeTypeObj) return;

  const attrs = makeAttrs(file);
  const node = nodeTypeObj.create(attrs);
  const insertPos = Math.min(pos, view.state.doc.content.size);
  view.dispatch(view.state.tr.insert(insertPos, node));

  await uploadAndUpdateNode(view, file, nodeType, attrs, storage, encryptionCtx);
}
