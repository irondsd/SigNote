'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { useReorder } from '@/hooks/useReorder';
import { calculatePosition } from '@/utils/calculatePosition';
import styles from './BaseGrid.module.scss';

type BaseItem = {
  position: number;
};

type BaseGridProps<T extends BaseItem> = {
  notes: T[] | undefined;
  getId: (note: T) => string;
  reorderType: 'notes' | 'secrets' | 'seals';
  renderCard: (note: T, onClick: () => void, showArchivedBadge: boolean, isDragDisabled: boolean) => ReactNode;
  renderOverlayCard: (note: T, showArchivedBadge: boolean) => ReactNode;
  archive?: boolean;
  onNewNote?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
  onNoteClick: (note: T) => void;
  children?: ReactNode;
};

export function BaseGrid<T extends BaseItem>({
  notes,
  getId,
  reorderType,
  renderCard,
  renderOverlayCard,
  archive = false,
  onNewNote,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
  onNoteClick,
  children,
}: BaseGridProps<T>) {
  const [activeNote, setActiveNote] = useState<T | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<{ width: number; height: number } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reorderMutation = useReorder(reorderType);

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  const noteIds = useMemo(() => (notes ?? []).map(getId), [notes, getId]);
  const dragEnabled = !isDragDisabled && (notes?.length ?? 0) > 1;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const note = notes?.find((n) => getId(n) === event.active.id);
      setActiveNote(note ?? null);
      const rect = event.active.rect.current.initial;
      if (rect) setActiveDragSize({ width: rect.width, height: rect.height });
    },
    [notes, getId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveNote(null);
      setActiveDragSize(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !notes) return;

      const oldIndex = notes.findIndex((n) => getId(n) === active.id);
      const newIndex = notes.findIndex((n) => getId(n) === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const withoutDragged = notes.filter((_, i) => i !== oldIndex);
      const above = newIndex > 0 ? withoutDragged[newIndex - 1].position : null;
      const below = newIndex < withoutDragged.length ? withoutDragged[newIndex].position : null;
      const newPosition = calculatePosition(above, below);

      reorderMutation.mutate({ id: active.id as string, position: newPosition, oldIndex, newIndex });
    },
    [notes, getId, reorderMutation],
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
            {notes.map((note) =>
              renderCard(note, () => onNoteClick(note), showArchivedBadge, !dragEnabled),
            )}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeNote ? (
            <div style={activeDragSize ? { width: activeDragSize.width, height: activeDragSize.height } : undefined}>
              {renderOverlayCard(activeNote, showArchivedBadge)}
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

      {children}
    </>
  );
}
