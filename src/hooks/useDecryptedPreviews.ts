'use client';

import { useEffect, useState } from 'react';
import { type CachedSecretNote } from '@/hooks/useSecretMutations';
import { decryptSecretBody } from '@/lib/crypto';

type Preview = { content: string; iv: string };

export function useDecryptedPreviews(notes: CachedSecretNote[] | undefined, mek: CryptoKey | null) {
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());

  useEffect(() => {
    if (!mek || !notes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing state when mek is revoked is intentional
      setPreviews(new Map());
      return;
    }

    const toDecrypt = notes.filter((n) => {
      if (!n.encryptedBody) return false;
      const cached = previews.get(n._id);
      return !cached || cached.iv !== n.encryptedBody.iv;
    });
    if (toDecrypt.length === 0) return;

    Promise.all(
      toDecrypt.map(async (n) => {
        try {
          const content = await decryptSecretBody(mek, n.encryptedBody!);
          return [n._id, content, n.encryptedBody!.iv] as [string, string, string];
        } catch {
          return [n._id, '', n.encryptedBody!.iv] as [string, string, string];
        }
      }),
    ).then((results) => {
      setPreviews((prev) => {
        const next = new Map(prev);
        results.forEach(([id, content, iv]) => next.set(id, { content, iv }));
        return next;
      });
    });
  }, [mek, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  return previews;
}
