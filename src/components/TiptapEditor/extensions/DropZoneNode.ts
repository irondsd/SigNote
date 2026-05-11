import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DropZoneView } from '../DropZoneView';

export const DropZoneNode = Node.create({
  name: 'dropZone',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="drop-zone"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'drop-zone' }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DropZoneView);
  },
});
