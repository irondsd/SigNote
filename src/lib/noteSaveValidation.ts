import { MAX_CONTENT, MAX_TITLE } from '@/config/constants';

export function getNoteSaveError(title: string, content: string): string | null {
  if (title.length > MAX_TITLE) return 'Title is too long';
  if (content.length > MAX_CONTENT) return 'Content is too large to save';
  return null;
}
