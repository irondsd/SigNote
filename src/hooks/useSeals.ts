import { CachedSealNote } from './useSealMutations';
import { useNoteTier } from './internal/useNoteTier';

export const SEALS_CONFIG = { key: 'seals', endpoint: '/api/seals' } as const;

export const useSeals = (params: {
  archived?: boolean;
  search?: string;
  tags?: string[];
  tagMode?: 'or' | 'and';
  enabled?: boolean;
}) => useNoteTier<CachedSealNote>(SEALS_CONFIG, params);
