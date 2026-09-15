import { extractFileIds, stripSealKeyedAttachments } from '@/lib/fileIds';

const file = (id: string, keyNoteId?: string) =>
  `<div data-type="file-attachment" data-file-id="${id}" data-filename="a.pdf" data-size="10" data-mime-type="application/pdf"${
    keyNoteId ? ` data-key-note-id="${keyNoteId}"` : ''
  }></div>`;
const image = (id: string, keyNoteId?: string) =>
  `<div data-type="image-attachment" data-file-id="${id}" data-filename="a.png" data-size="10" data-mime-type="image/png"${
    keyNoteId ? ` data-key-note-id="${keyNoteId}"` : ''
  }></div>`;

describe('stripSealKeyedAttachments', () => {
  it('removes Seal-keyed files and images, keeping vault attachments and text', () => {
    const html = `<p>before</p>${file('sealed', 'seal-1')}${image('sealed-image', 'seal-1')}${file('vault')}<p>after</p>`;

    const stripped = stripSealKeyedAttachments(html);

    expect(extractFileIds(stripped)).toEqual(['vault']);
    expect(stripped).toBe(`<p>before</p>${file('vault')}<p>after</p>`);
  });

  it('leaves content without Seal-keyed attachments unchanged', () => {
    const html = `<p>text</p>${image('vault')}`;

    expect(stripSealKeyedAttachments(html)).toBe(html);
  });
});
