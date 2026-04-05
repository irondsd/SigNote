import { CachedSecretNote } from './useSecretMutations';
import { useNoteTier } from './internal/useNoteTier';

export const SECRETS_CONFIG = { key: 'secrets', endpoint: '/api/secrets' } as const;

export const useSecrets = (params: { archived?: boolean; search?: string }) =>
  useNoteTier<CachedSecretNote>(SECRETS_CONFIG, params);
