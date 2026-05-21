export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_USER_STORAGE = 100 * 1024 * 1024; // 100 MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/json',
  'application/msword',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
]);

export function isImageMime(mime: string) {
  return mime.startsWith('image/');
}

export const UPLOAD_COUNTER_KEY = 'fileUploadCounter';
