import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileAttachmentView } from '../FileAttachmentView';

export type FileAttachmentAttrs = {
  fileId: string | null;
  filename: string;
  size: number;
  mimeType: string;
  uploadStatus: 'uploading' | 'complete' | 'error';
};

export const FileAttachmentNode = Node.create({
  name: 'fileAttachment',
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
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="file-attachment"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'file-attachment',
        'data-file-id': HTMLAttributes.fileId,
        'data-filename': HTMLAttributes.filename,
        'data-size': HTMLAttributes.size,
        'data-mime-type': HTMLAttributes.mimeType,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView);
  },
});
