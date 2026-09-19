import type { Metadata } from 'next';

import { ExportVaultClient } from './ExportVaultClient';

export const metadata: Metadata = { title: 'Export vault · SigNote' };

export default function ExportVaultPage() {
  return <ExportVaultClient />;
}
