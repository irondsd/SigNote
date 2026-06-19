'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useNewNoteState } from '@/hooks/useNewNoteState';
import { useTagCountBump } from '@/hooks/useTagMutations';
import { clearDraft } from '@/lib/draft';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';

type Tier = 'note' | 'secret' | 'seal';
type InitialContent = { title: string; content: string };

/**
 * Shared state + validation for the three "new note" modals. Wraps
 * {@link useNewNoteState} and adds the upload/tags bookkeeping and the
 * title/content guards every tier repeats.
 *
 * `prepare()` validates only (no side effects) so encrypted tiers can run it
 * *before* prompting for a passphrase; `commitDraft()` is called separately,
 * after the save is committed, so a cancelled unlock keeps the draft intact.
 */
export function useNewNoteForm(tier: Tier, onClose: () => void, initialContent?: InitialContent) {
  const state = useNewNoteState(tier, onClose, initialContent);
  const [isUploading, setIsUploading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const bumpTagCounts = useTagCountBump();

  const prepare = (): InitialContent | null => {
    if (state.title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return null;
    }
    if (state.content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return null;
    }
    if (state.isTitleEmpty && state.isContentEmpty) return null;
    return { title: state.title.trim(), content: state.content.trim() };
  };

  const commitDraft = () => {
    if (state.draftTimerRef.current) clearTimeout(state.draftTimerRef.current);
    clearDraft();
  };

  return { ...state, isUploading, setIsUploading, tags, setTags, bumpTagCounts, prepare, commitDraft };
}

export type NewNoteForm = ReturnType<typeof useNewNoteForm>;
