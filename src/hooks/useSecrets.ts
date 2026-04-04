import { CachedSecretNote } from './useSecretMutations';
import { useNoteTier } from './internal/useNoteTier';

const CONFIG = { key: 'secrets', endpoint: '/api/secrets' } as const;

export const useSecrets = (params: { archived?: boolean; search?: string }) =>
  useNoteTier<CachedSecretNote>(CONFIG, params);
