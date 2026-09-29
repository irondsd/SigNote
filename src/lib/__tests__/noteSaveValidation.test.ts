import { MAX_CONTENT, MAX_TITLE } from '@/config/constants';
import { getNoteSaveError } from '@/lib/noteSaveValidation';

it('accepts both maximum lengths and reports the first exceeded limit', () => {
  const title = 't'.repeat(MAX_TITLE);
  const content = 'c'.repeat(MAX_CONTENT);

  expect(getNoteSaveError(title, content)).toBeNull();
  expect(getNoteSaveError(`${title}t`, `${content}c`)).toBe('Title is too long');
  expect(getNoteSaveError(title, `${content}c`)).toBe('Content is too large to save');
});
