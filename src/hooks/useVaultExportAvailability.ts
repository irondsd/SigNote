'use client';

import { useQuery } from '@tanstack/react-query';

import type { VaultExportAvailability } from '@/lib/vaultBackup/exportTypes';
import { trpcClient } from '@/lib/trpcClient';

export function useVaultExportAvailability() {
  return useQuery<VaultExportAvailability>({
    queryKey: ['vault-export-availability'],
    queryFn: () => trpcClient.vaultExport.availability.query(),
    staleTime: 60_000,
  });
}
