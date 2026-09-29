import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

export type AttachmentAttrs = {
  fileId: string | null;
  filename: string;
  size: number;
  mimeType: string;
  uploadStatus: 'uploading' | 'complete' | 'error';
  /** The Seal whose note key the attachment is under; null for vault or plaintext files. */
  keyNoteId: string | null;
};

type AttachmentNodeOptions = {
  name: string;
  htmlType: string;
  view: Parameters<typeof ReactNodeViewRenderer>[0];
};

export function createAttachmentNode({ name, htmlType, view }: AttachmentNodeOptions) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        fileId: { default: null },
        filename: { default: '' },
        size: { default: 0 },
        mimeType: { default: '' },
        uploadStatus: { default: 'uploading' },
        keyNoteId: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('data-key-note-id') },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${htmlType}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          'data-type': htmlType,
          'data-file-id': HTMLAttributes.fileId,
          'data-filename': HTMLAttributes.filename,
          'data-size': HTMLAttributes.size,
          'data-mime-type': HTMLAttributes.mimeType,
          'data-key-note-id': HTMLAttributes.keyNoteId,
        }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });
}
