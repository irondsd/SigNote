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
});
