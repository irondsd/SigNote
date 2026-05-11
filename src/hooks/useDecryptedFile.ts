'use client';

import { useState, useEffect, useRef } from 'react';
import { useFileEncryption } from '@/contexts/FileEncryptionContext';
import { decryptFileBytes } from '@/lib/crypto';

type DecryptedFileState = {
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
};

export function useDecryptedFile(fileId: string | null) {
  const { mek } = useFileEncryption();
  const [state, setState] = useState<DecryptedFileState>({ blobUrl: null, loading: false, error: null });
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fileId) {
      setState({ blobUrl: null, loading: false, error: null });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let url: string | null = null;

    (async () => {
      setState({ blobUrl: null, loading: true, error: null });

      try {
        const res = await fetch(`/api/files/${fileId}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed to fetch file');

        const isEncrypted = res.headers.get('X-File-Encrypted') === 'true';

        if (isEncrypted) {
          const iv = res.headers.get('X-Encryption-IV');
          if (!iv) throw new Error('Missing encryption IV');
          if (!mek) throw new Error('Encryption key not available');

          const cipherBytes = await res.arrayBuffer();
          const plainBytes = await decryptFileBytes(mek, iv, cipherBytes);

          const mimeType = res.headers.get('X-Original-MimeType') ?? 'application/octet-stream';
          url = URL.createObjectURL(new Blob([plainBytes.buffer as ArrayBuffer], { type: mimeType }));
        } else {
          const bytes = await res.arrayBuffer();
          const mimeType = res.headers.get('Content-Type') ?? 'application/octet-stream';
          url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        }

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;

        if (!controller.signal.aborted) {
          setState({ blobUrl: url, loading: false, error: null });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Failed to load file';
        setState({ blobUrl: null, loading: false, error: message });
      }
    })();

    return () => {
      controller.abort();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [fileId, mek]);

  return state;
}
