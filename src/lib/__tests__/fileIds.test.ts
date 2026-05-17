import { extractFileIds } from '@/lib/fileIds';

describe('extractFileIds', () => {
  it('extracts multiple file ids', () => {
    const html = '<img data-file-id="abc123" /><img data-file-id="def456" />';
    expect(extractFileIds(html)).toEqual(['abc123', 'def456']);
  });

  it('returns empty array when no ids found', () => {
    expect(extractFileIds('<p>hello</p>')).toEqual([]);
    expect(extractFileIds('')).toEqual([]);
  });

  it('handles ids within nested HTML', () => {
    const html = '<div><p><img src="x" data-file-id="nested-id" class="foo" /></p></div>';
    expect(extractFileIds(html)).toEqual(['nested-id']);
  });

  it('handles various id formats', () => {
    const html = '<img data-file-id="uuid-with-dashes-123" /><img data-file-id="simple" />';
    expect(extractFileIds(html)).toEqual(['uuid-with-dashes-123', 'simple']);
  });
});
