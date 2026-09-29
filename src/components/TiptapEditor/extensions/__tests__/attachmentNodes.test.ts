/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { FileAttachmentNode } from '@/components/TiptapEditor/extensions/FileAttachmentNode';
import { ImageAttachmentNode } from '@/components/TiptapEditor/extensions/ImageAttachmentNode';

it('round trips file and image attachment nodes with their distinct types and Seal key binding', () => {
  const schema = getSchema([StarterKit, FileAttachmentNode, ImageAttachmentNode]);
  const source = document.createElement('div');
  source.innerHTML =
    '<div data-type="file-attachment" data-key-note-id="seal-1"></div>' +
    '<div data-type="image-attachment" data-key-note-id="seal-2"></div>';

  const doc = DOMParser.fromSchema(schema).parse(source);
  expect(doc.child(0).type.name).toBe('fileAttachment');
  expect(doc.child(1).type.name).toBe('imageAttachment');
  expect(doc.child(0).attrs.keyNoteId).toBe('seal-1');
  expect(doc.child(1).attrs.keyNoteId).toBe('seal-2');

  const output = document.createElement('div');
  output.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  expect(output.querySelector('div[data-type="file-attachment"]')).toHaveAttribute('data-key-note-id', 'seal-1');
  expect(output.querySelector('div[data-type="image-attachment"]')).toHaveAttribute('data-key-note-id', 'seal-2');
});
