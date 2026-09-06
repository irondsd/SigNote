'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { toast } from 'sonner';

import { SortableWrapper } from '@/components/SortableWrapper/SortableWrapper';
import { AuthCard } from '@/components/AuthCard/AuthCard';
import { useOtpVault, type AuthRecord } from '@/contexts/OtpVaultContext';
import { useAuthCodes } from '@/hooks/useAuthCodes';
import { isDegeneratePosition } from '@/lib/otp/order';
import { calculatePosition } from '@/utils/calculatePosition';
import { variableGridSortingStrategy } from '@/utils/variableGridSortingStrategy';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import s from './AuthGrid.module.scss';

const clearDragging = () => delete document.body.dataset.dragging;

type AuthGridProps = {
  records: AuthRecord[];
  onEdit: (record: AuthRecord) => void;
  onExport: (record: AuthRecord) => void;
  onDelete: (record: AuthRecord) => void;
};

export function AuthGrid({ records, onEdit, onExport, onDelete }: AuthGridProps) {
  const { serverTimeOffsetMs, setPosition, renumber, setStyle, setArchived, syncState } = useOtpVault();
  const { byId } = useAuthCodes(records, serverTimeOffsetMs);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);

  // v1 queues nothing offline, so every write needs a live session. The menu
  // says why rather than failing silently when the button is pressed.
  const readOnly = syncState !== 'online';
  const readOnlyReason = syncState === 'signed-out' ? 'Sign in again to make changes' : 'Reconnect to make changes';

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  const ids = useMemo(() => records.map((r) => r.id), [records]);
  const dragEnabled = !readOnly && records.length > 1;

  const handleCopy = useCallback(async (code: string | undefined) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      // The same toast the editor and version history use, rather than a badge
      // of the card's own — one copy affordance across the app.
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy the code');
    }
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    document.body.dataset.dragging = 'true';
    setActiveId(event.active.id as string);
    const rect = event.active.rect.current.initial;
    if (rect) setDragSize({ width: rect.width, height: rect.height });
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      clearDragging();
      setActiveId(null);
      setDragSize(null);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = records.findIndex((r) => r.id === active.id);
      const newIndex = records.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Unlike the note tiers there is no pinned group here, so the neighbours
      // are simply the entries either side of the drop once the dragged card is
      // taken out of the list. The list is sorted descending, so `above` holds
      // the higher position — which is the order `calculatePosition` expects.
      const without = records.filter((_, i) => i !== oldIndex);
      const above = newIndex > 0 ? (without[newIndex - 1]?.position ?? null) : null;
      const below = without[newIndex]?.position ?? null;
      const position = calculatePosition(above, below);

      // A midpoint only works while the neighbours still have a gap between
      // them. Once they collide — repeated bisection, or positions left equal
      // by an earlier bug — no single value can sit between them, and the drop
      // would silently do nothing. Renumber the whole list instead, which also
      // repairs the rows that had collided.
      try {
        if (isDegeneratePosition(position, above, below)) {
          await renumber([...without.slice(0, newIndex), records[oldIndex], ...without.slice(newIndex)]);
        } else {
          await setPosition(active.id as string, position);
        }
      } catch {
        toast.error('Could not reorder');
      }
    },
    [records, setPosition, renumber],
  );

  const cardProps = (record: AuthRecord) => ({
    record,
    state: byId[record.id] ?? { seconds: 0, fraction: 1 },
    readOnly,
    readOnlyReason,
    onCopy: () => handleCopy(byId[record.id]?.code),
    onEdit: () => onEdit(record),
    onExport: () => onExport(record),
    onStyleChange: (patch: { color?: NoteColor | null; pattern?: NotePattern | null }) =>
      setStyle(record.id, patch).catch(() => toast.error('Could not update the card style')),
    onArchivedChange: (archived: boolean) =>
      setArchived(record.id, archived)
        .then(() => toast.success(archived ? 'Moved to the archive' : 'Restored'))
        .catch(() => toast.error('Could not update the card')),
    onDelete: () => onDelete(record),
  });

  const activeRecord = activeId ? records.find((r) => r.id === activeId) : null;

  return (
    <DndContext
      sensors={dragEnabled ? sensors : undefined}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragging}
    >
      <SortableContext items={ids} strategy={variableGridSortingStrategy}>
        <div className={s.grid}>
          {records.map((record) => (
            <SortableWrapper key={record.id} id={record.id} isDragDisabled={!dragEnabled}>
              <AuthCard {...cardProps(record)} />
            </SortableWrapper>
          ))}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeRecord ? (
          <div style={dragSize ? { width: dragSize.width, height: dragSize.height } : undefined}>
            <AuthCard {...cardProps(activeRecord)} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
