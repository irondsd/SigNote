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
import { useInitialNoteId } from '@/hooks/useInitialNoteId';
import { useDecryptedPreviews } from '@/hooks/useDecryptedPreviews';

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
  const decryptedPreviews = useDecryptedPreviews(notes, mek);

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

  const decryptAndOpen = useCallback(async (cryptoKey: CryptoKey) => {
    const noteToOpen = pendingNoteRef.current;
    pendingNoteRef.current = null;
    if (noteToOpen && cryptoKey && noteToOpen.encryptedBody) {
      try {
        const content = await decryptSecretBody(cryptoKey, noteToOpen.encryptedBody);
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
  }, []);

  const handleNoteClick = useCallback(
    async (note: CachedSecretNote) => {
      if (!isUnlocked) {
        pendingNoteRef.current = note;
        if (lockType === 'soft') {
          try {
            await ctxRehydrate();
          } catch {
            await guard.execute(decryptAndOpen);
          }
        } else {
          await guard.execute(decryptAndOpen);
        }
        return;
      }
      await openDecryptedNote(note);
    },
    [isUnlocked, lockType, guard, ctxRehydrate, openDecryptedNote, decryptAndOpen],
  );

  useEffect(() => {
    const note = pendingNoteRef.current;
    if (!mek || !note) return;
    pendingNoteRef.current = null;
    openDecryptedNote(note);
  }, [mek, openDecryptedNote]);

  useInitialNoteId(notes, (n) => n._id, handleNoteClick, phase !== 'loading');

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
          pattern={note.pattern}
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
          pattern={note.pattern}
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
