'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
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
import type { NoteDocument } from '@/models/Note';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { SortableNoteCard } from '@/components/NoteCard/SortableNoteCard';
import { NoteModal } from '@/components/NoteModal/NoteModal';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useReorder } from '@/hooks/useReorder';
import { calculatePosition } from '@/utils/calculatePosition';
import styles from './NotesGrid.module.scss';
import { EmptyStateArchive } from '../EmptyStateArchive/EmptyStateArchive';

type NotesGridProps = {
  notes: NoteDocument[] | undefined;
  archive?: boolean;
  onNewNote?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
};

export function NotesGrid({
  notes,
  archive = false,
  onNewNote,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
}: NotesGridProps) {
  const [selected, setSelected] = useState<NoteDocument | null>(null);
  const [activeNote, setActiveNote] = useState<NoteDocument | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<{ width: number; height: number } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reorderMutation = useReorder('notes');

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const noteIds = useMemo(() => (notes ?? []).map((n) => n._id.toString()), [notes]);

  const dragEnabled = !isDragDisabled && (notes?.length ?? 0) > 1;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const note = notes?.find((n) => n._id.toString() === event.active.id);
      setActiveNote(note ?? null);
      const rect = event.active.rect.current.initial;
      if (rect) {
        setActiveDragSize({ width: rect.width, height: rect.height });
      }
    },
    [notes],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveNote(null);
      setActiveDragSize(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !notes) return;

      const oldIndex = notes.findIndex((n) => n._id.toString() === active.id);
      const newIndex = notes.findIndex((n) => n._id.toString() === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Remove the dragged note, then find neighbors at the target position
      const withoutDragged = notes.filter((_, i) => i !== oldIndex);

      // Notes sorted descending: index 0 = highest position
      const above = newIndex > 0 ? withoutDragged[newIndex - 1].position : null;
      const below = newIndex < withoutDragged.length ? withoutDragged[newIndex].position : null;

      const newPosition = calculatePosition(above, below);

      reorderMutation.mutate({
        id: active.id as string,
        position: newPosition,
        oldIndex,
        newIndex,
      });
    },
    [notes, reorderMutation],
  );

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) {
          onLoadMore();
        }
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
              <SortableNoteCard
                key={note._id.toString()}
                note={note}
                onClick={() => setSelected(note)}
                showArchivedBadge={showArchivedBadge}
                isDragDisabled={!dragEnabled}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeNote ? (
            <div style={activeDragSize ? { width: activeDragSize.width, height: activeDragSize.height } : undefined}>
              <NoteCard note={activeNote} onClick={() => {}} showArchivedBadge={showArchivedBadge} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {hasMore && (
        <div
          ref={sentinelRef}
          style={{
            height: '1px',
            visibility: 'hidden',
            marginTop: '20px',
          }}
          data-testid="notes-sentinel"
        />
      )}

      {isLoadingMore && (
        <div className={styles.loading}>
          <span className={styles.spinner} />
        </div>
      )}

      {selected && <NoteModal note={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
