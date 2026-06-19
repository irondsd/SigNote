'use client';

import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { VaultArchivePage } from '@/components/VaultPage/VaultArchivePage';

export default function SecretsArchivePage() {
  return VaultArchivePage({
    title: 'Archived Secrets',
    backHref: '/secrets',
    backLabel: 'Secrets',
    backIcon: 'secrets',
    useItems: useSecrets,
    Grid: SecretsGrid,
  });
}
