import type { Metadata } from 'next';
import { ImportVaultClient } from './ImportVaultClient';

export const metadata: Metadata = { title: 'Import vault · SigNote' };

export default function ImportVaultPage() {
  return <ImportVaultClient />;
}
