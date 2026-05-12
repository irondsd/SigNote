import { useCallback } from 'react';
import { toast } from 'sonner';
import posthog from 'posthog-js';

export function useAttachmentActions(
  fileId: string | null,
  filename: string,
  blobUrl: string | null,
  deleteNode: () => void,
  mimeType?: string,
) {
  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!fileId) {
        posthog.capture('file_deleted', { was_uploaded: false });
        deleteNode();
        return;
      }
      try {
        const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        posthog.capture('file_deleted', { was_uploaded: true });
        deleteNode();
      } catch {
        toast.error('Failed to delete file');
      }
    },
    [fileId, deleteNode],
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (blobUrl) {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.click();
        posthog.capture('file_downloaded', { mime_category: getMimeCategory(mimeType) });
      }
    },
    [blobUrl, filename, mimeType],
  );

  return { handleDelete, handleDownload };
}

function getMimeCategory(mimeType?: string): 'image' | 'document' | 'other' {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf' || mimeType.startsWith('application/vnd.'))
    return 'document';
  return 'other';
}
