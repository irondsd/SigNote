'use client';

import { ShieldCheck } from 'lucide-react';
import styles from './page.module.scss';

export default function SecretsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.heading}>Secrets</h1>
      </div>
      <div className={styles.empty}>
        <ShieldCheck size={48} strokeWidth={1.2} />
        <p>Secrets (Tier 2) — coming soon</p>
      </div>
    </div>
  );
}
