'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import type { DraftContent, DraftData } from '@/lib/draft';

export function useNewNoteState(draftType: DraftData['type'], onClose: () => void, initialContent?: DraftContent) {
  const [title, setTitle] = useState(initialContent?.title ?? '');
  const [content, setContent] = useState(initialContent?.content ?? '');
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [color, setColor] = useState<string | null>(initialContent?.color ?? null);
  const [pattern, setPattern] = useState<string | null>(initialContent?.pattern ?? null);

  const isTitleEmpty = !title.trim();
  const hasAttachment = !!content && /data-type="(file|image)-attachment"/.test(content);
  const isContentEmpty = !hasAttachment && (!content || content.replace(/<[^>]*>/g, '').trim() === '');
  const isDirty = !isTitleEmpty || !isContentEmpty;
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);

  const handleClose = () => confirmClose(onClose);

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
    pattern,
    setPattern,
    isTitleEmpty,
    isContentEmpty,
    isDirty,
    showConfirm,
    onCancelClose,
    handleClose,
    handleConfirmDiscard: onConfirmDiscard,
  };
}
