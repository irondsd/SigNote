'use client';

import { useSeals } from '@/hooks/useSeals';
import { SealsGrid } from '@/components/SealsGrid/SealsGrid';
import { VaultArchivePage } from '@/components/VaultPage/VaultArchivePage';

export default function SealsArchivePage() {
  return VaultArchivePage({
    title: 'Archived Seals',
    backHref: '/seals',
    backLabel: 'Seals',
    backIcon: 'seals',
    useItems: useSeals,
    Grid: SealsGrid,
  });
}
