import { useCallback } from 'react';
import { toast } from 'sonner';

export function useAttachmentActions(
  fileId: string | null,
  filename: string,
  blobUrl: string | null,
  deleteNode: () => void,
) {
  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!fileId) {
        deleteNode();
        return;
      }
      try {
        const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
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
      }
    },
    [blobUrl, filename],
  );

  return { handleDelete, handleDownload };
}
