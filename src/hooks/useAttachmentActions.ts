import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import { generationHeaders } from '@/lib/encryptionGeneration';
import { useFileEncryption } from '@/contexts/FileEncryptionContext';
import { fetchFileBlob } from '@/hooks/useDecryptedFile';

function saveUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * `blobUrl` is the already-loaded file, when the view needs one to render (an
 * image preview). Without it, download fetches and decrypts on demand — a file
 * card has nothing to show, so it shouldn't pull the file until asked.
 */
export function useAttachmentActions(
  fileId: string | null,
  filename: string,
  blobUrl: string | null,
  deleteNode: () => void,
  mimeType?: string,
) {
  const { mek } = useFileEncryption();
  const [downloading, setDownloading] = useState(false);

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!fileId) {
        posthog.capture('file_deleted', { was_uploaded: false });
        deleteNode();
        return;
      }
      try {
        const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE', headers: generationHeaders() });
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
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (blobUrl) {
        saveUrl(blobUrl, filename);
      } else {
        if (!fileId || downloading) return;
        setDownloading(true);
        try {
          const url = URL.createObjectURL(await fetchFileBlob(fileId, mek));
          saveUrl(url, filename);
          // Revoke on the next tick: the click has to start the save first.
          setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch {
          toast.error('Failed to download file');
          return;
        } finally {
          setDownloading(false);
        }
      }
      posthog.capture('file_downloaded', { mime_category: getMimeCategory(mimeType) });
    },
    [blobUrl, fileId, mek, downloading, filename, mimeType],
  );

  return { handleDelete, handleDownload, downloading };
}

function getMimeCategory(mimeType?: string): 'image' | 'document' | 'other' {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf' || mimeType.startsWith('application/vnd.'))
    return 'document';
  return 'other';
}
