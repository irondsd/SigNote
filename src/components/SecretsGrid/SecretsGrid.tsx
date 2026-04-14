'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type CachedSecretNote } from '@/hooks/useSecretMutations';
import { SortableEncryptedCard } from '@/components/EncryptedNoteCard/SortableEncryptedCard';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SecretNoteModal } from '@/components/SecretNoteModal/SecretNoteModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { decryptSecretBody } from '@/lib/crypto';
import { BaseGrid } from '@/components/BaseGrid/BaseGrid';
import { getStableKey } from '@/lib/stableKeyStore';

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
  const { mek, phase, lockType, rehydrate: ctxRehydrate } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [selected, setSelected] = useState<CachedSecretNote | null>(null);
  const [selectedDecrypted, setSelectedDecrypted] = useState<string>('');
  const pendingNoteRef = useRef<CachedSecretNote | null>(null);
  const [initialNoteId, setInitialNoteId] = useState<string | null>(null);
  const openedInitialRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialNoteId(new URLSearchParams(window.location.search).get('id'));
  }, []);
  const [decryptedPreviews, setDecryptedPreviews] = useState<Map<string, { content: string; iv: string }>>(new Map());

  const guard = useEncryptionGuard();

  const openDecryptedNote = useCallback(
    async (note: CachedSecretNote) => {
      if (!mek || !note.encryptedBody) {
        setSelected(note);
        setSelectedDecrypted('');
        return;
      }

      try {
        const content = await decryptSecretBody(mek, note.encryptedBody);
        setSelected(note);
        setSelectedDecrypted(content);
      } catch {
        setSelected(note);
        setSelectedDecrypted('');
      }
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

  const handleNoteClick = useCallback(
    async (note: CachedSecretNote) => {
      if (!isUnlocked) {
        pendingNoteRef.current = note;
        if (lockType === 'soft') {
          // For soft lock, try to rehydrate directly (deviceShare still in sessionStorage)
          try {
            await ctxRehydrate();
            // On success, mek is restored; useEffect below will open the note
          } catch {
            // If rehydrate fails, fall back to passphrase modal
            await guard.execute(async (mek) => {
              const noteToOpen = pendingNoteRef.current;
              pendingNoteRef.current = null;
              if (noteToOpen && mek && noteToOpen.encryptedBody) {
                try {
                  const content = await decryptSecretBody(mek, noteToOpen.encryptedBody);
                  setSelected(noteToOpen);
                  setSelectedDecrypted(content);
                } catch {
                  setSelected(noteToOpen);
                  setSelectedDecrypted('');
                }
              } else {
                setSelected(noteToOpen || null);
                setSelectedDecrypted('');
              }
            });
          }
        } else {
          // For hard lock, use guard to show passphrase
          await guard.execute(async (mek) => {
            const noteToOpen = pendingNoteRef.current;
            pendingNoteRef.current = null;
            if (noteToOpen && mek && noteToOpen.encryptedBody) {
              try {
                const content = await decryptSecretBody(mek, noteToOpen.encryptedBody);
                setSelected(noteToOpen);
                setSelectedDecrypted(content);
              } catch {
                setSelected(noteToOpen);
                setSelectedDecrypted('');
              }
            } else {
              setSelected(noteToOpen || null);
              setSelectedDecrypted('');
            }
          });
        }
        return;
      }
      await openDecryptedNote(note);
    },
    [isUnlocked, lockType, guard, ctxRehydrate, openDecryptedNote],
  );

  // Trigger open after mek becomes available (either from rehydrate or passphrase unlock)
  useEffect(() => {
    const note = pendingNoteRef.current;
    if (!mek || !note) return;
    pendingNoteRef.current = null;
    openDecryptedNote(note);
  }, [mek, openDecryptedNote]);

  useEffect(() => {
    if (!initialNoteId || openedInitialRef.current || !notes) return;
    if (phase === 'loading') return; // wait for session/profile to settle before acting
    const note = notes.find((n) => n._id === initialNoteId);
    if (!note) return;
    openedInitialRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleNoteClick(note);
  }, [notes, initialNoteId, handleNoteClick, phase]);

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
      onNoteClick={async (note) => {
        window.history.replaceState(null, '', `${window.location.pathname}?id=${note._id}`);
        await handleNoteClick(note);
      }}
      renderCard={(note, onClick, showBadge, dragDisabled) => (
        <SortableEncryptedCard
          key={getStableKey(note._id)}
          id={note._id}
          title={note.title}
          updatedAt={note.updatedAt}
          color={note.color}
          onClick={onClick}
          decryptedContent={isUnlocked ? decryptedPreviews.get(note._id)?.content : undefined}
          ciphertext={note.encryptedBody?.ciphertext}
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
          ciphertext={note.encryptedBody?.ciphertext}
          showArchivedBadge={showBadge}
          archived={note.archived}
        />
      )}
    >
      {guard.PassphraseGuard}

      {selected && (
        <SecretNoteModal
          note={selected}
          decryptedContent={selectedDecrypted}
          onClose={() => {
            window.history.replaceState(null, '', window.location.pathname);
            setSelected(null);
            setSelectedDecrypted('');
          }}
        />
      )}
    </BaseGrid>
  );
}
