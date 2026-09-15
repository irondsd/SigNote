import { Fragment, Schema, Slice } from '@tiptap/pm/model';

import { stripForeignAttachments } from '../foreignAttachments';

const attachment = { group: 'block', atom: true, attrs: { fileId: { default: null }, keyNoteId: { default: null } } };
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    text: {},
    fileAttachment: attachment,
    imageAttachment: attachment,
  },
});

const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const file = (fileId: string, keyNoteId: string | null = null) =>
  schema.nodes.fileAttachment.create({ fileId, keyNoteId });
const image = (fileId: string, keyNoteId: string | null = null) =>
  schema.nodes.imageAttachment.create({ fileId, keyNoteId });
const ids = (slice: Slice) => {
  const found: string[] = [];
  slice.content.descendants((node) => {
    if (node.attrs.fileId) found.push(node.attrs.fileId);
  });
  return found;
};

describe('stripForeignAttachments', () => {
  it("keeps this Seal's attachments and unowned ones, untouched", () => {
    const slice = new Slice(Fragment.fromArray([p('a'), file('own', 'seal-1'), image('vault')]), 1, 0);

    const result = stripForeignAttachments(slice, 'seal-1');

    expect(result.dropped).toBe(0);
    expect(result.slice).toBe(slice);
  });

  it("drops another Seal's attachments, of either kind", () => {
    const slice = new Slice(
      Fragment.fromArray([p('a'), file('foreign', 'seal-2'), image('foreign-image', 'seal-2'), file('own', 'seal-1')]),
      0,
      0,
    );

    const result = stripForeignAttachments(slice, 'seal-1');

    expect(result.dropped).toBe(2);
    expect(ids(result.slice)).toEqual(['own']);
  });

  it('drops every Seal-keyed attachment in an editor with no Seal', () => {
    const slice = new Slice(Fragment.fromArray([file('sealed', 'seal-1'), file('vault')]), 0, 0);

    const result = stripForeignAttachments(slice, undefined);

    expect(result.dropped).toBe(1);
    expect(ids(result.slice)).toEqual(['vault']);
  });

  it('reaches attachments nested inside other blocks', () => {
    const quote = schema.nodes.blockquote.create(null, [p('quoted'), file('foreign', 'seal-2')]);
    const slice = new Slice(Fragment.fromArray([quote, p('after')]), 0, 0);

    const result = stripForeignAttachments(slice, 'seal-1');

    expect(result.dropped).toBe(1);
    expect(ids(result.slice)).toEqual([]);
    expect(result.slice.content.textBetween(0, result.slice.content.size, '\n')).toBe('quoted\nafter');
  });

  it('closes an open edge whose node was removed, so the slice stays valid', () => {
    const slice = new Slice(Fragment.fromArray([p('start'), file('foreign', 'seal-2')]), 1, 0);
    const head = new Slice(Fragment.fromArray([file('foreign', 'seal-2'), p('end')]), 0, 1);

    expect(stripForeignAttachments(slice, 'seal-1').slice.openStart).toBe(1);
    const trimmed = stripForeignAttachments(head, 'seal-1').slice;
    expect(trimmed.openStart).toBe(0);
    expect(trimmed.openEnd).toBe(1);
  });
});
