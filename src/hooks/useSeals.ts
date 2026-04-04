import { CachedSealNote } from './useSealMutations';
import { useNoteTier } from './internal/useNoteTier';

const CONFIG = { key: 'seals', endpoint: '/api/seals' } as const;

export const useSeals = (params: { archived?: boolean; search?: string }) =>
  useNoteTier<CachedSealNote>(CONFIG, params);
