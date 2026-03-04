'use client';

import { Vault } from 'lucide-react';
import styles from './page.module.scss';

export default function VaultsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.heading}>Vaults</h1>
      </div>
      <div className={styles.empty}>
        <Vault size={48} strokeWidth={1.2} />
        <p>Vaults (Tier 3) — coming soon</p>
      </div>
    </div>
  );
}
