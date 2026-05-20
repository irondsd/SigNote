'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CheckCircle, Download, ShieldAlert } from 'lucide-react';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useProfile } from '@/hooks/useProfile';
import { loadDeviceShare } from '@/lib/crypto';
import { backupFilename, buildBackup } from '@/lib/recoveryBackup';
import s from './page.module.scss';

export default function BackupRecoveryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { phase } = useEncryption();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    if (!profileLoading && profile && !profile.hasEncryptionProfile) router.replace('/secrets');
  }, [profileLoading, profile, router]);

  if (status !== 'authenticated') return null;

  const userId = session?.user?.id;

  const performDownload = () => {
    if (!userId) return;
    const deviceShare = loadDeviceShare();
    if (!deviceShare) {
      setShowPassphrase(true);
      return;
    }
    const backup = buildBackup(userId, deviceShare);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename(userId);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    posthog.capture('recovery_backup_downloaded');
    setDownloaded(true);
  };

  const handleDownloadClick = () => {
    if (phase === 'unlocked') {
      performDownload();
    } else {
      setShowPassphrase(true);
    }
  };

  if (downloaded) {
    return (
      <div className={s.container}>
        <div className={s.card}>
          <div className={s.successIcon}>
            <CheckCircle size={48} strokeWidth={1.3} />
          </div>
          <h2 className={s.heading}>Backup saved</h2>
          <p className={s.intro}>
            Store this file somewhere safe — a password manager, an encrypted drive, or another secure location. Anyone
            with this file <strong>and</strong> access to your account can decrypt your secrets and seals.
          </p>
          <Button variant="outline" className={s.actionBtn} onClick={() => setDownloaded(false)}>
            Download again
          </Button>
          <div className={s.crosslinks}>
            <p>
              <Link href="/profile">← Back to profile</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.container}>
      <div className={s.card}>
        <div className={s.iconWrap}>
          <Download size={40} strokeWidth={1.3} />
        </div>
        <h2 className={s.heading}>Back up your encryption profile</h2>
        <p className={s.intro}>
          A recovery file lets you regain access to your secrets and seals if you forget your passphrase. Without it,
          forgetting your passphrase means losing your encrypted data permanently.
        </p>

        <div className={s.warning}>
          <ShieldAlert size={18} className={s.warningIcon} />
          <div className={s.warningBody}>
            <span className={s.warningTitle}>This file is a recovery key.</span>
            <span>
              Anyone who has this file and can sign in to your account can decrypt your data. Do not email it to
              yourself. Do not store it in cloud notes. Use a password manager or an encrypted drive.
            </span>
          </div>
        </div>

        <Button className={s.actionBtn} onClick={handleDownloadClick}>
          <Download size={16} />
          Download backup file
        </Button>

        <div className={s.divider} />

        <div className={s.crosslinks}>
          <p>
            Already have a backup and forgot your passphrase? <Link href="/recover">Go to recovery →</Link>
          </p>
        </div>
      </div>

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => {
            setShowPassphrase(false);
            performDownload();
          }}
          onClose={() => setShowPassphrase(false)}
          displayName={session?.user?.name ?? undefined}
        />
      )}
    </div>
  );
}
