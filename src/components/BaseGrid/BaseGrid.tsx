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

const clearDragging = () => delete document.body.dataset.dragging;
import { SortableContext } from '@dnd-kit/sortable';
import { createVariableGridSortingStrategy, measureNaturalGridItemHeights } from '@/utils/variableGridSortingStrategy';
import { useReorder } from '@/hooks/useReorder';
import { calculatePosition } from '@/utils/calculatePosition';
import s from './BaseGrid.module.scss';

type BaseItem = {
  position: number;
  pinned?: boolean;
};

type BaseGridProps<T extends BaseItem> = {
  notes: T[] | undefined;
  getId: (note: T) => string;
  reorderType: 'notes' | 'secrets' | 'seals';
  renderCard: (
    note: T,
    onClick: (rect: DOMRect) => void,
    showArchivedBadge: boolean,
    isDragDisabled: boolean,
  ) => ReactNode;
  renderOverlayCard: (note: T, showArchivedBadge: boolean) => ReactNode;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  showArchivedBadge?: boolean;
  isDragDisabled?: boolean;
  onNoteClick: (note: T, rect: DOMRect) => void;
  children?: ReactNode;
};

export function BaseGrid<T extends BaseItem>({
  notes,
  getId,
  reorderType,
  renderCard,
  renderOverlayCard,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  showArchivedBadge = false,
  isDragDisabled = false,
  onNoteClick,
  children,
}: BaseGridProps<T>) {
  const [activeNote, setActiveNote] = useState<T | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [naturalHeights, setNaturalHeights] = useState<number[] | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reorderMutation = useReorder(reorderType);

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);
  const sortingStrategy = useMemo(() => createVariableGridSortingStrategy(naturalHeights), [naturalHeights]);

  const noteIds = useMemo(() => (notes ?? []).map(getId), [notes, getId]);
  const dragEnabled = !isDragDisabled && (notes?.length ?? 0) > 1;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      document.body.dataset.dragging = 'true';
      setNaturalHeights(measureNaturalGridItemHeights(gridRef.current));
      const note = notes?.find((n) => getId(n) === event.active.id);
      setActiveNote(note ?? null);
    },
    [notes, getId],
  );

  const handleDragCancel = useCallback(() => {
    clearDragging();
    setActiveNote(null);
    setNaturalHeights(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragging();
      setActiveNote(null);
      setNaturalHeights(null);
      const { active, over } = event;
      if (
        !over ||
        active.id === over.id ||
        !notes ||
        String(active.id).startsWith('temp-') ||
        String(over.id).startsWith('temp-')
      )
        return;

      const oldIndex = notes.findIndex((n) => getId(n) === active.id);
      const newIndex = notes.findIndex((n) => getId(n) === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Pinned notes are forced to the top of the list (sort: pinned desc, position desc),
      // so the array is only monotonic by position *within* a pinned group. Compute the
      // drop neighbors from same-group items only — otherwise a pinned note's position can
      // leak in as a neighbor and produce a midpoint that lands the note in the wrong place.
      const dragged = notes[oldIndex];
      const withoutDragged = notes.filter((_, i) => i !== oldIndex);
      const sameGroup = (item: T) => Boolean(item.pinned) === Boolean(dragged.pinned);

      let above: number | null = null;
      for (let i = newIndex - 1; i >= 0; i--) {
        if (sameGroup(withoutDragged[i])) {
          above = withoutDragged[i].position;
          break;
        }
      }
      let below: number | null = null;
      for (let i = newIndex; i < withoutDragged.length; i++) {
        if (sameGroup(withoutDragged[i])) {
          below = withoutDragged[i].position;
          break;
        }
      }
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
    return null;
  }

  return (
    <>
      <DndContext
        sensors={dragEnabled ? sensors : undefined}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={noteIds} strategy={sortingStrategy}>
          <div ref={gridRef} className={s.grid} data-testid="card-grid">
            {notes.map((note) =>
              renderCard(
                note,
                (rect) => !getId(note).startsWith('temp-') && onNoteClick(note, rect),
                showArchivedBadge,
                !dragEnabled,
              ),
            )}
          </div>
        </SortableContext>

        {/*
          The overlay root is already sized to the dragged card's measured rect by dnd-kit, and
          the cards are `height: 100%`, so rendering one straight into it makes the preview keep
          the stretched row height a grid card gets. Do not wrap it in a box sized from
          `active.rect.current.initial`: that ref is populated in an effect *after* `onDragStart`
          runs, so it reads null on the first drag and the previous card's size on every one
          after — which is exactly how a short card ends up shrinking to its natural height.
        */}
        <DragOverlay dropAnimation={null}>
          {activeNote ? renderOverlayCard(activeNote, showArchivedBadge) : null}
        </DragOverlay>
      </DndContext>

      {hasMore && <div ref={sentinelRef} style={{ height: '1px', visibility: 'hidden', marginTop: '20px' }} />}

      {isLoadingMore && (
        <div className={s.loading}>
          <span className={s.spinner} />
        </div>
      )}

      {children}
    </>
  );
}
