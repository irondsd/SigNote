'use client';

import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { NewSealModal } from '@/components/NewSealModal/NewSealModal';
import { VaultListPage } from '@/components/VaultPage/VaultListPage';

export default function SealsPage() {
  return VaultListPage({
    title: 'Seals',
    archiveHref: '/seals/archive',
    newLabel: 'New Seal',
    useItems: useSeals,
    Grid: SealsGrid,
    NewModal: NewSealModal,
  });
}
