'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CachedSecretNote } from '@/hooks/useSecretMutations';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SecretNoteModal } from '@/components/SecretNoteModal/SecretNoteModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useDecryptedPreviews } from '@/hooks/useDecryptedPreviews';
import { decryptSecretBody } from '@/lib/crypto';
import { StripShell } from './StripShell';

type SecretsStripProps = {
  notes: CachedSecretNote[];
  totalCount: number;
  cap?: number;
  query: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onItemClick?: () => void;
};

export function SecretsStrip({
  notes,
  totalCount,
  cap,
  query,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onItemClick,
}: SecretsStripProps) {
  const { mek, phase, lockType, rehydrate: ctxRehydrate } = useEncryption();
  const isUnlocked = phase === 'unlocked';
  const [selected, setSelected] = useState<CachedSecretNote | null>(null);
  const [selectedDecrypted, setSelectedDecrypted] = useState<string>('');
  const pendingNoteRef = useRef<CachedSecretNote | null>(null);
  const visible = useMemo(() => (cap ? notes.slice(0, cap) : notes), [notes, cap]);
  const decryptedPreviews = useDecryptedPreviews(visible, mek);
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

  const handleClick = useCallback(
    async (note: CachedSecretNote) => {
      onItemClick?.();
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
    [isUnlocked, lockType, guard, ctxRehydrate, openDecryptedNote, decryptAndOpen, onItemClick],
  );

  useEffect(() => {
    const note = pendingNoteRef.current;
    if (!mek || !note) return;
    pendingNoteRef.current = null;
    openDecryptedNote(note);
  }, [mek, openDecryptedNote]);

  return (
    <>
      <StripShell
        title="Secrets"
        totalCount={totalCount}
        seeAllHref={cap && totalCount > cap ? `/search?q=${encodeURIComponent(query)}&tiers=secrets` : undefined}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
      >
        {visible.map((note) => (
          <EncryptedNoteCard
            key={note._id}
            title={note.title}
            updatedAt={note.updatedAt}
            color={note.color}
            pattern={note.pattern}
            onClick={() => handleClick(note)}
            decryptedContent={isUnlocked ? decryptedPreviews.get(note._id)?.content : undefined}
            ciphertext={note.encryptedBody?.ciphertext}
            showArchivedBadge={note.archived}
            archived={note.archived}
            pinned={note.pinned}
            hasExpiry={Boolean(note.expiresAt || note.burnAfterReading)}
            burnAfterReading={note.burnAfterReading}
          />
        ))}
      </StripShell>
      {guard.PassphraseGuard}
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
    </>
  );
}
