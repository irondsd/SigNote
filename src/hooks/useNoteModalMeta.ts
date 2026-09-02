'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTagCountBump } from '@/hooks/useTagMutations';
import { useBurnArming } from '@/hooks/useBurnArming';

/** The metadata-only patches this hook emits; a subset of every tier's update input. */
type MetaPatch = { id: string } & Partial<{
  archived: boolean;
  color: string | null;
  pattern: string | null;
  tags: string[];
  pinned: boolean;
  expiresAt: string | null;
  burnAfterReading: boolean;
}>;

type MetaNote = {
  _id: unknown;
  title?: string | null;
  archived: boolean;
  color?: string | null;
  pattern?: string | null;
  updatedAt: string | Date;
  pinned?: boolean;
  expiresAt?: string | Date | null;
  burnAfterReading?: boolean;
  tags?: unknown[];
};

/**
 * The view/edit state and metadata handlers shared by NoteModal,
 * SecretNoteModal and SealNoteModal — title, style, pin, expiry, tags, archive,
 * formatting-bar and version-history toggles. Each tier still owns its own
 * content/encryption, save and delete logic.
 *
 * `update` is the tier's `updateX.mutate` (bound); `burnReady` gates burn-arming
 * until the body is readable (seals arm only after decrypt).
 */
export function useNoteModalMeta(
  note: MetaNote,
  update: (patch: MetaPatch) => void,
  options?: { burnReady?: boolean },
) {
  const noteId = String(note._id);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [pattern, setPattern] = useState<string | null>(note.pattern ?? null);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | Date>(note.updatedAt);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pinned, setPinned] = useState<boolean>(note.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState<Date | string | null>(note.expiresAt ?? null);
  const [burnAfterReading, setBurnAfterReading] = useState<boolean>(note.burnAfterReading ?? false);
  const [tags, setTags] = useState<string[]>(() => (note.tags ?? []).map(String));
  const [historyOpen, setHistoryOpen] = useState(false);
  // Once history has been opened, returning to the note modal must not replay
  // the entrance animation — it's the same surface switching modes.
  const [historyWasOpen, setHistoryWasOpen] = useState(false);
  const [menuOpened, setMenuOpened] = useState(false);
  const bumpTagCounts = useTagCountBump();

  const handleArchiveToggle = () => {
    const next = !isArchived;
    setIsArchived(next);
    update({ id: noteId, archived: next });
  };

  const handleColorChange = (newColor: string | null) => {
    setColor(newColor);
    update({ id: noteId, color: newColor });
  };

  const handlePatternChange = (newPattern: string | null) => {
    setPattern(newPattern);
    update({ id: noteId, pattern: newPattern });
  };

  const handleTagsChange = (ids: string[]) => {
    bumpTagCounts(
      ids.filter((id) => !tags.includes(id)),
      tags.filter((id) => !ids.includes(id)),
    );
    setTags(ids);
    update({ id: noteId, tags: ids });
  };

  const handleTogglePinned = (next: boolean) => {
    setPinned(next);
    update({ id: noteId, pinned: next });
  };

  const handleSetExpiry = (next: { expiresAt: Date | null; burnAfterReading: boolean }) => {
    setExpiresAt(next.expiresAt);
    setBurnAfterReading(next.burnAfterReading);
    update({
      id: noteId,
      expiresAt: next.expiresAt ? next.expiresAt.toISOString() : null,
      burnAfterReading: next.burnAfterReading,
    });
  };

  const { wasInitiallyBurning } = useBurnArming({
    initialBurn: note.burnAfterReading ?? false,
    expiresAt,
    isReady: options?.burnReady ?? true,
    onArm: () => update({ id: noteId, expiresAt: new Date().toISOString(), burnAfterReading: true }),
  });

  return {
    noteId,
    editing,
    setEditing,
    title,
    setTitle,
    isArchived,
    color,
    pattern,
    stylePickerOpen,
    setStylePickerOpen,
    updatedAt,
    setUpdatedAt,
    showFormatBar,
    setShowFormatBar,
    editor,
    setEditor,
    isUploading,
    setIsUploading,
    pinned,
    expiresAt,
    burnAfterReading,
    tags,
    setTags,
    historyOpen,
    setHistoryOpen,
    historyWasOpen,
    setHistoryWasOpen,
    menuOpened,
    setMenuOpened,
    handleArchiveToggle,
    handleColorChange,
    handlePatternChange,
    handleTagsChange,
    handleTogglePinned,
    handleSetExpiry,
    wasInitiallyBurning,
  };
}
