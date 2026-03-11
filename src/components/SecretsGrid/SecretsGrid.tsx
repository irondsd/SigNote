'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { type CachedSecretNote } from '@/hooks/useSecretMutations';
import { SortableEncryptedCard } from '@/components/EncryptedNoteCard/SortableEncryptedCard';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SecretNoteModal } from '@/components/SecretNoteModal/SecretNoteModal';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { useReorderSecret } from '@/hooks/useReorderSecret';
import { useEncryption } from '@/contexts/EncryptionContext';
import { decryptSecretBody } from '@/lib/crypto';
import { calculatePosition } from '@/utils/calculatePosition';
import styles from './SecretsGrid.module.scss';

type SecretsGridProps = {
  notes: CachedSecretNote[] | undefined;
  archive?: boolean;
  onNewNote?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SecretsGrid({
  notes,
  archive = false,
  onNewNote,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: SecretsGridProps) {
  const { mek, isUnlocked } = useEncryption();
  const [selected, setSelected] = useState<CachedSecretNote | null>(null);
  const [selectedDecrypted, setSelectedDecrypted] = useState<string>('');
  const [pendingNote, setPendingNote] = useState<CachedSecretNote | null>(null);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [activeNote, setActiveNote] = useState<CachedSecretNote | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<{ width: number; height: number } | null>(null);
  const [decryptedPreviews, setDecryptedPreviews] = useState<Map<string, string>>(new Map());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reorderMutation = useReorderSecret();

  // Decrypt previews when mek becomes available or notes change
  useEffect(() => {
    if (!mek || !notes) return;

    const alreadyDecrypted = new Set(decryptedPreviews.keys());
    const toDecrypt = notes.filter((n) => !alreadyDecrypted.has(n._id) && n.encryptedBody);
    if (toDecrypt.length === 0) return;

    Promise.all(
      toDecrypt.map(async (n) => {
        try {
          const content = await decryptSecretBody(mek, n.encryptedBody!);
          return [n._id, content] as [string, string];
        } catch {
          return [n._id, ''] as [string, string];
        }
      }),
    ).then((results) => {
      setDecryptedPreviews((prev) => {
        const next = new Map(prev);
        results.forEach(([id, content]) => next.set(id, content));
        return next;
      });
    });
  }, [mek, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear decrypted content when locked
  useEffect(() => {
    if (!isUnlocked) {
      setDecryptedPreviews(new Map());
      setSelected(null);
      setSelectedDecrypted('');
    }
  }, [isUnlocked]);

  // After unlock, open the note that was clicked while locked
  useEffect(() => {
    if (!pendingNote || !mek) return;
    const note = pendingNote;
    setPendingNote(null);
    const cached = decryptedPreviews.get(note._id);
    if (cached !== undefined) {
      setSelected(note);
      setSelectedDecrypted(cached);
    } else if (note.encryptedBody) {
      decryptSecretBody(mek, note.encryptedBody)
        .then((content) => {
          setSelected(note);
          setSelectedDecrypted(content);
        })
        .catch(() => {
          setSelected(note);
          setSelectedDecrypted('');
        });
    } else {
      setSelected(note);
      setSelectedDecrypted('');
    }
  }, [mek, pendingNote]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNoteClick = useCallback(
    (note: CachedSecretNote) => {
      if (!isUnlocked) {
        setPendingNote(note);
        setShowPassphrase(true);
        return;
      }
      const decrypted = decryptedPreviews.get(note._id) ?? '';
      setSelected(note);
      setSelectedDecrypted(decrypted);
    },
    [isUnlocked, decryptedPreviews],
  );

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  const noteIds = useMemo(() => (notes ?? []).map((n) => n._id), [notes]);
  const dragEnabled = !isDragDisabled && (notes?.length ?? 0) > 1 && isUnlocked;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const note = notes?.find((n) => n._id === event.active.id);
      setActiveNote(note ?? null);
      const rect = event.active.rect.current.initial;
      if (rect) setActiveDragSize({ width: rect.width, height: rect.height });
    },
    [notes],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveNote(null);
      setActiveDragSize(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !notes) return;

      const oldIndex = notes.findIndex((n) => n._id === active.id);
      const newIndex = notes.findIndex((n) => n._id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const withoutDragged = notes.filter((_, i) => i !== oldIndex);
      const above = newIndex > 0 ? withoutDragged[newIndex - 1].position : null;
      const below = newIndex < withoutDragged.length ? withoutDragged[newIndex].position : null;
      const newPosition = calculatePosition(above, below);

      reorderMutation.mutate({ id: active.id as string, position: newPosition, oldIndex, newIndex });
    },
    [notes, reorderMutation],
  );

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || !onLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) onLoadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (!notes || notes.length === 0) {
    return archive ? <EmptyStateArchive /> : <EmptyState onNewNote={onNewNote} />;
  }

  return (
    <>
      <DndContext
        sensors={dragEnabled ? sensors : undefined}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={noteIds} strategy={rectSortingStrategy}>
          <div className={styles.grid}>
            {notes.map((note) => (
              <SortableEncryptedCard
                key={note._id}
                id={note._id}
                title={note.title}
                updatedAt={note.updatedAt}
                color={note.color}
                onClick={() => handleNoteClick(note)}
                decryptedContent={isUnlocked ? decryptedPreviews.get(note._id) : undefined}
                showArchivedBadge={showArchivedBadge}
                archived={note.archived}
                isDragDisabled={!dragEnabled}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeNote ? (
            <div style={activeDragSize ? { width: activeDragSize.width, height: activeDragSize.height } : undefined}>
              <EncryptedNoteCard
                title={activeNote.title}
                updatedAt={activeNote.updatedAt}
                color={activeNote.color}
                onClick={() => {}}
                decryptedContent={isUnlocked ? decryptedPreviews.get(activeNote._id) : undefined}
                showArchivedBadge={showArchivedBadge}
                archived={activeNote.archived}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {hasMore && (
        <div ref={sentinelRef} style={{ height: '1px', visibility: 'hidden', marginTop: '20px' }} />
      )}

      {isLoadingMore && (
        <div className={styles.loading}>
          <span className={styles.spinner} />
        </div>
      )}

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => setShowPassphrase(false)}
          onClose={() => {
            setShowPassphrase(false);
            setPendingNote(null);
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
    </>
  );
}
