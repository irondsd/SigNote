import { replaceFileIds } from '@/lib/promotionFiles';

describe('replaceFileIds', () => {
  test('rewrites matching image and file attachment ids without touching other attributes', () => {
    const html =
      '<img data-file-id="old-image" src="blob:x"><a data-file-id=\'old-file\' data-name="old-image">file</a>';
    const replacements = new Map([
      ['old-image', 'new-image'],
      ['old-file', 'new-file'],
    ]);

    expect(replaceFileIds(html, replacements)).toBe(
      '<img data-file-id="new-image" src="blob:x"><a data-file-id=\'new-file\' data-name="old-image">file</a>',
    );
  });

  test('rewrites both id attributes an editor attachment node carries', () => {
    const html =
      '<div data-type="file-attachment" fileid="old" filename="a.pdf" data-file-id="old" data-filename="a.pdf"></div>';

    expect(replaceFileIds(html, new Map([['old', 'new']]))).toBe(
      '<div data-type="file-attachment" fileid="new" filename="a.pdf" data-file-id="new" data-filename="a.pdf"></div>',
    );
  });

  test('binds replacements to the seal they were re-keyed for, replacing any earlier binding', () => {
    const html =
      '<div data-type="file-attachment" fileid="old" data-file-id="old" data-key-note-id="stale"></div>' +
      '<div data-type="image-attachment" data-file-id="untouched"></div>';

    expect(replaceFileIds(html, new Map([['old', 'new']]), 'seal-1')).toBe(
      '<div data-type="file-attachment" fileid="new" data-file-id="new" data-key-note-id="seal-1"></div>' +
        '<div data-type="image-attachment" data-file-id="untouched"></div>',
    );
  });
});
