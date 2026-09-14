'use client';

import { useState, useEffect, useRef } from 'react';
import { useFileEncryption } from '@/contexts/FileEncryptionContext';
import { decryptFileBytes } from '@/lib/crypto';
import { generationHeaders } from '@/lib/encryptionGeneration';

type DecryptedFileState = {
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
};

/** Fetch an attachment and, when it is encrypted, decrypt it in the browser. */
export async function fetchFileBlob(fileId: string, mek: CryptoKey | null, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`/api/files/${fileId}`, { signal, headers: generationHeaders() });
  if (!res.ok) throw new Error('Failed to fetch file');

  if (res.headers.get('X-File-Encrypted') !== 'true') {
    const bytes = await res.arrayBuffer();
    return new Blob([bytes], { type: res.headers.get('Content-Type') ?? 'application/octet-stream' });
  }

  const iv = res.headers.get('X-Encryption-IV');
  if (!iv) throw new Error('Missing encryption IV');
  if (!mek) throw new Error('Encryption key not available');

  const plainBytes = await decryptFileBytes(mek, iv, await res.arrayBuffer());
  const mimeType = res.headers.get('X-Original-MimeType') ?? 'application/octet-stream';
  return new Blob([plainBytes.buffer as ArrayBuffer], { type: mimeType });
}

export function useDecryptedFile(fileId: string | null) {
  const { mek } = useFileEncryption();
  const [state, setState] = useState<DecryptedFileState>({ blobUrl: null, loading: false, error: null });
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fileId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let url: string | null = null;

    (async () => {
      setState({ blobUrl: null, loading: true, error: null });

      try {
        url = URL.createObjectURL(await fetchFileBlob(fileId, mek, controller.signal));

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

  // With no file the effect never runs, so a previous file's state must not leak through.
  return fileId ? state : IDLE;
}

const IDLE: DecryptedFileState = { blobUrl: null, loading: false, error: null };
