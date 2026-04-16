'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { saveDraft, clearDraft, type DraftData } from '@/lib/draft';

export function useNewNoteState(
  draftType: DraftData['type'],
  onClose: () => void,
  initialContent?: { title: string; content: string },
) {
  const [title, setTitle] = useState(initialContent?.title ?? '');
  const [content, setContent] = useState(initialContent?.content ?? '');
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTitleEmpty = !title.trim();
  const isContentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
  const isDirty = !isTitleEmpty || !isContentEmpty;
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);

  const handleClose = () => confirmClose(onClose);
  const handleConfirmDiscard = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    clearDraft();
    onConfirmDiscard();
  };

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (isContentEmpty) return;

    draftTimerRef.current = setTimeout(() => {
      saveDraft({ type: draftType, title, content, savedAt: Date.now() });
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, isContentEmpty, draftType]);

  return {
    title,
    setTitle,
    content,
    setContent,
    showFormatBar,
    setShowFormatBar,
    editor,
    setEditor,
    color,
    setColor,
    isTitleEmpty,
    isContentEmpty,
    showConfirm,
    onCancelClose,
    handleClose,
    handleConfirmDiscard,
    draftTimerRef,
  };
}
