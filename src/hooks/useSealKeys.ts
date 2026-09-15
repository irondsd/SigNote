'use client';

import { useEffect, useState } from 'react';
import { generateSealKey, importSealKey, wrapSealKey } from '@/lib/crypto';
import type { EncryptedPayload } from '@/types/crypto';

/**
 * A Seal's note key, for its attachments.
 *
 * `stored` is the wrapper the Seal row already has. A Seal without one — a new
 * Seal, or one never written — gets a key minted here and wrapped under the MEK
 * straight away, so the raw bytes are never held: the wrapper is ciphertext,
 * safe to keep in a draft, and it becomes the row's `wrappedNoteKey` on the
 * first save. Attachments uploaded before that save are under this key, which
 * is why the save must reuse it rather than mint another.
 *
 * `noteKey` exists only while the MEK does, so a lock takes it too.
 */
export function useSealKeys(sealId: string, stored: EncryptedPayload | null, mek: CryptoKey | null) {
  const [minted, setMinted] = useState<{ sealId: string; wrappedNoteKey: EncryptedPayload } | null>(null);
  const wrappedNoteKey = stored ?? (minted?.sealId === sealId ? minted.wrappedNoteKey : null);

  useEffect(() => {
    if (stored || !mek || minted?.sealId === sealId) return;
    let live = true;
    const nek = generateSealKey();
    void wrapSealKey(mek, sealId, nek)
      .then((wrapper) => {
        if (live) setMinted({ sealId, wrappedNoteKey: wrapper });
      })
      .catch(() => {})
      .finally(() => nek.fill(0));
    return () => {
      live = false;
    };
  }, [stored, mek, sealId, minted]);

  const [imported, setImported] = useState<{ wrapper: EncryptedPayload; mek: CryptoKey; key: CryptoKey } | null>(null);
  useEffect(() => {
    if (!mek || !wrappedNoteKey) return;
    let live = true;
    void importSealKey(mek, sealId, wrappedNoteKey)
      .then((key) => {
        if (live) setImported({ wrapper: wrappedNoteKey, mek, key });
      })
      .catch(() => {
        if (live) setImported(null);
      });
    return () => {
      live = false;
    };
  }, [mek, sealId, wrappedNoteKey]);

  const noteKey = imported && mek && imported.mek === mek && imported.wrapper === wrappedNoteKey ? imported.key : null;
  return { wrappedNoteKey, noteKey };
}
