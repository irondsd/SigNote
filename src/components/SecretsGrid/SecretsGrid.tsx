'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type CachedSecretNote } from '@/hooks/useSecretMutations';
import { SortableEncryptedCard } from '@/components/EncryptedNoteCard/SortableEncryptedCard';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SecretNoteModal } from '@/components/SecretNoteModal/SecretNoteModal';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { decryptSecretBody } from '@/lib/crypto';
import { BaseGrid } from '@/components/BaseGrid/BaseGrid';

type SecretsGridProps = {
  notes: CachedSecretNote[] | undefined;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SecretsGrid({
  notes,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: SecretsGridProps) {
  const { mek, phase } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [selected, setSelected] = useState<CachedSecretNote | null>(null);
  const [selectedDecrypted, setSelectedDecrypted] = useState<string>('');
  const pendingNoteRef = useRef<CachedSecretNote | null>(null);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [decryptedPreviews, setDecryptedPreviews] = useState<Map<string, { content: string; iv: string }>>(new Map());

  const openDecryptedNote = useCallback(
    (note: CachedSecretNote) => {
      if (!mek || !note.encryptedBody) {
        setSelected(note);
        setSelectedDecrypted('');
        return;
      }

      decryptSecretBody(mek, note.encryptedBody)
        .then((content) => {
          setSelected(note);
          setSelectedDecrypted(content);
        })
        .catch(() => {
          setSelected(note);
          setSelectedDecrypted('');
        });
    },
    [mek],
  );

  // Decrypt previews when mek becomes available or notes change; clear on lock
  useEffect(() => {
    if (!mek || !notes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing state when mek is revoked is intentional, not cascading
      setDecryptedPreviews(new Map());
      return;
    }

    // Re-decrypt notes that are new or whose encryptedBody IV has changed (i.e. were auto-saved)
    const toDecrypt = notes.filter((n) => {
      if (!n.encryptedBody) return false;
      const cached = decryptedPreviews.get(n._id);
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
      setDecryptedPreviews((prev) => {
        const next = new Map(prev);
        results.forEach(([id, content, iv]) => next.set(id, { content, iv }));
        return next;
      });
    });
  }, [mek, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger open after passphrase unlock provides mek (mirrors SealNoteModal pattern)
  useEffect(() => {
    const note = pendingNoteRef.current;
    if (!mek || !note) return;
    pendingNoteRef.current = null;

    if (!note.encryptedBody) {
      setSelected(note);
      setSelectedDecrypted('');
      return;
    }

    decryptSecretBody(mek, note.encryptedBody)
      .then((content) => {
        setSelected(note);
        setSelectedDecrypted(content);
      })
      .catch(() => {
        setSelected(note);
        setSelectedDecrypted('');
      });
  }, [mek]);

  const handleNoteClick = useCallback(
    (note: CachedSecretNote) => {
      if (!isUnlocked) {
        pendingNoteRef.current = note;
        setShowPassphrase(true);
        return;
      }
      openDecryptedNote(note);
    },
    [isUnlocked, openDecryptedNote],
  );

  return (
    <BaseGrid
      notes={notes}
      getId={(note) => note._id}
      reorderType="secrets"
      onLoadMore={onLoadMore}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      showArchivedBadge={showArchivedBadge}
      isDragDisabled={isDragDisabled}
      onNoteClick={handleNoteClick}
      renderCard={(note, onClick, showBadge, dragDisabled) => (
        <SortableEncryptedCard
          key={note._id}
          id={note._id}
          title={note.title}
          updatedAt={note.updatedAt}
          color={note.color}
          onClick={onClick}
          decryptedContent={isUnlocked ? decryptedPreviews.get(note._id)?.content : undefined}
          showArchivedBadge={showBadge}
          archived={note.archived}
          isDragDisabled={dragDisabled}
        />
      )}
      renderOverlayCard={(note, showBadge) => (
        <EncryptedNoteCard
          title={note.title}
          updatedAt={note.updatedAt}
          color={note.color}
          onClick={() => {}}
          decryptedContent={isUnlocked ? decryptedPreviews.get(note._id)?.content : undefined}
          showArchivedBadge={showBadge}
          archived={note.archived}
        />
      )}
    >
      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => {
            setShowPassphrase(false);
            // pendingNote is picked up by the useEffect above when mek becomes available
          }}
          onClose={() => {
            setShowPassphrase(false);
            pendingNoteRef.current = null;
          }}
        />
      )}

      {selected && (
        <SecretNoteModal
          note={selected}
          decryptedContent={selectedDecrypted}
          onClose={() => {
            setSelected(null);
            setSelectedDecrypted('');
          }}
        />
      )}
    </BaseGrid>
  );
}
