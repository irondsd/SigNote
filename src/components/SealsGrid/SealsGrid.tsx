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
import { SortableContext } from '@dnd-kit/sortable';
import { variableGridSortingStrategy } from '@/utils/variableGridSortingStrategy';
import { type CachedSealNote } from '@/hooks/useSealMutations';
import { SortableEncryptedCard } from '@/components/EncryptedNoteCard/SortableEncryptedCard';
import { EncryptedNoteCard } from '@/components/EncryptedNoteCard/EncryptedNoteCard';
import { SealNoteModal } from '@/components/SealNoteModal/SealNoteModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { useReorderSeal } from '@/hooks/useReorderSeal';
import { calculatePosition } from '@/utils/calculatePosition';
import styles from './SealsGrid.module.scss';

type SealsGridProps = {
  notes: CachedSealNote[] | undefined;
  archive?: boolean;
  onNewNote?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function SealsGrid({
  notes,
  archive = false,
  onNewNote,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: SealsGridProps) {
  const [selected, setSelected] = useState<CachedSealNote | null>(null);
  const [activeNote, setActiveNote] = useState<CachedSealNote | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<{ width: number; height: number } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reorderMutation = useReorderSeal();

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  const noteIds = useMemo(() => (notes ?? []).map((n) => n._id), [notes]);
  const dragEnabled = !isDragDisabled && (notes?.length ?? 0) > 1;

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
        <SortableContext items={noteIds} strategy={variableGridSortingStrategy}>
          <div className={styles.grid}>
            {notes.map((note) => (
              <SortableEncryptedCard
                key={note._id}
                id={note._id}
                title={note.title}
                updatedAt={note.updatedAt}
                color={note.color}
                // Seals never show decrypted previews in the grid
                onClick={() => setSelected(note)}
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

      {selected && <SealNoteModal note={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
