import type { CachedNote } from './useNoteMutations';
import { useNoteTier } from './internal/useNoteTier';

const CONFIG = { key: 'notes' } as const;

export const useNotes = (params: {
  archived?: boolean;
  search?: string;
  tags?: string[];
  tagMode?: 'or' | 'and';
  enabled?: boolean;
}) => useNoteTier<CachedNote>(CONFIG, params);
