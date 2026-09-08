'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useNewNoteState } from '@/hooks/useNewNoteState';
import { useTagCountBump } from '@/hooks/useTagMutations';
import type { DraftContent } from '@/lib/draft';
import { useDraftRecovery } from '@/hooks/useDraftRecovery';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';

type Tier = 'note' | 'secret' | 'seal';
type InitialContent = DraftContent;

export function useNewNoteForm(
  tier: Tier,
  onClose: () => void,
  initialContent?: InitialContent,
  mek?: CryptoKey | null,
) {
  const state = useNewNoteState(tier, onClose, initialContent);
  const [isUploading, setIsUploading] = useState(false);
  const [tags, setTags] = useState<string[]>(initialContent?.tags ?? []);
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

  const recovery = useDraftRecovery(
    tier,
    {
      title: state.title,
      content: state.content,
      color: state.color,
      pattern: state.pattern,
      tags,
      draftId: initialContent?.draftId,
      sourceId: initialContent?.sourceId,
    },
    state.isDirty,
    mek,
  );

  const save = (request: () => Promise<unknown>) => {
    bumpTagCounts(tags, []);
    recovery.save(async () => {
      try {
        return await request();
      } catch (error) {
        bumpTagCounts([], tags);
        throw error;
      }
    });
  };

  return {
    ...state,
    isUploading,
    setIsUploading,
    tags,
    setTags,
    bumpTagCounts,
    prepare,
    recovery,
    save,
    handleConfirmDiscard: () => {
      recovery.discard();
      state.handleConfirmDiscard();
    },
  };
}

export type NewNoteForm = ReturnType<typeof useNewNoteForm>;
