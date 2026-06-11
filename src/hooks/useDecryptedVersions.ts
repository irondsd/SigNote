'use client';

import { useEffect, useState } from 'react';
import type { EncryptedPayload } from '@/types/crypto';
import type { DisplayVersion } from '@/components/VersionHistoryModal/VersionHistoryModal';
import type { EncryptedVersion } from './useVersions';

/**
 * Maps raw encrypted version rows into display versions by decrypting each
 * body. Pass `decrypt` as null while the MEK is unavailable — the mapping
 * pauses (returns the last result) instead of failing. A row that fails to
 * decrypt renders a placeholder body rather than poisoning the whole list.
 */
export function useDecryptedVersions(
  raw: EncryptedVersion[] | undefined,
  decrypt: ((payload: EncryptedPayload) => Promise<string>) | null,
): DisplayVersion[] | undefined {
  const [versions, setVersions] = useState<DisplayVersion[] | undefined>(undefined);

  useEffect(() => {
    if (!raw || !decrypt) return;
    let cancelled = false;
    (async () => {
      const mapped = await Promise.all(
        raw.map(async (v): Promise<DisplayVersion> => {
          let content = '';
          if (v.encryptedBody) {
            try {
              content = await decrypt(v.encryptedBody);
            } catch {
              content = '<p><em>Could not decrypt this version.</em></p>';
            }
          }
          return { _id: v._id, title: v.title, content, createdAt: v.createdAt };
        }),
      );
      if (!cancelled) setVersions(mapped);
    })();
    return () => {
      cancelled = true;
    };
  }, [raw, decrypt]);

  return versions;
}
