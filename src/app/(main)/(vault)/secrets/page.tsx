'use client';

import { useSecrets } from '@/hooks/useSecrets';
import { SecretsGrid } from '@/components/SecretsGrid/SecretsGrid';
import { NewSecretModal } from '@/components/NewSecretModal/NewSecretModal';
import { VaultListPage } from '@/components/VaultPage/VaultListPage';

export default function SecretsPage() {
  return VaultListPage({
    title: 'Secrets',
    emptyNoun: 'secret',
    archiveHref: '/secrets/archive',
    newLabel: 'New Secret',
    useItems: useSecrets,
    Grid: SecretsGrid,
    NewModal: NewSecretModal,
    showSetupDisplayName: true,
  });
}
