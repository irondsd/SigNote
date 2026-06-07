import { NoteDocument } from '@/models/Note';
import { useNoteTier } from './internal/useNoteTier';

const CONFIG = { key: 'notes', endpoint: '/api/notes' } as const;

export const useNotes = (params: {
  archived?: boolean;
  search?: string;
  tags?: string[];
  tagMode?: 'or' | 'and';
  enabled?: boolean;
}) => useNoteTier<NoteDocument>(CONFIG, params);
