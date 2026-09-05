'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Archive, SquarePlus } from 'lucide-react';
import { toast } from 'sonner';

import { AuthEnrollment } from '@/components/AuthEnrollment/AuthEnrollment';
import { AuthGrid } from '@/components/AuthGrid/AuthGrid';
import { EditAuthDialog } from '@/components/AuthDialogs/EditAuthDialog';
import { ExportAuthDialog } from '@/components/AuthDialogs/ExportAuthDialog';
import { NewAuthModal } from '@/components/NewAuthModal/NewAuthModal';
import { ArchivePageHeader } from '@/components/ArchivePageHeader/ArchivePageHeader';
import { EmptyStateArchive } from '@/components/EmptyStateArchive/EmptyStateArchive';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { UnauthenticatedState } from '@/components/UnauthenticatedState/UnauthenticatedState';
import { EncryptionSetup } from '@/components/EncryptionSetup/EncryptionSetup';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useOtpVault, type AuthRecord } from '@/contexts/OtpVaultContext';
import { useStepClock } from '@/hooks/useAuthCodes';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { AuthEmptyState } from './AuthEmptyState';
import s from './AuthPage.module.scss';

/** The main list and the archive are the same page with the filter flipped. */
type AuthPageProps = { archived: boolean };

export function AuthPage({ archived }: AuthPageProps) {
  const { status } = useSession();
  const { phase: encryptionPhase } = useEncryption();
  const vault = useOtpVault();
  const { execute, PassphraseGuard } = useSimpleEncryptionGuard();
  const isOnline = useOnlineStatus();

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<AuthRecord | null>(null);
  const [exporting, setExporting] = useState<AuthRecord | null>(null);
  const [deleting, setDeleting] = useState<AuthRecord | null>(null);

  const records = useMemo(() => vault.records.filter((r) => r.archived === archived), [vault.records, archived]);
  const headerSeconds = useStepClock(records[0]?.secrets?.period ?? 30);

  const readOnly = vault.syncState !== 'online';

  const handleEnroll = (trust: boolean) =>
    // Reuses the MEK when Secrets/Seals are already unlocked, and prompts for
    // the passphrase only when they are not.
    execute(async (mek) => {
      await vault.enroll(mek, { trust });
    });

  const body = () => {
    if (vault.phase === 'loading' || status === 'loading') {
      return (
        <div className={s.loading}>
          <span className={s.spinner} />
        </div>
      );
    }

    // Unlike every other vault page this one does not redirect when the session
    // goes away: a stored code is often exactly what the user needs in order to
    // sign back in. The sign-in card appears only when there is nothing local.
    if (vault.phase === 'signed-out') return <UnauthenticatedState />;

    if (encryptionPhase === 'setup') return <EncryptionSetup />;

    if (vault.phase === 'not-enrolled') {
      return <AuthEnrollment onEnroll={handleEnroll} online={isOnline && status === 'authenticated'} />;
    }

    if (records.length === 0) {
      return archived ? <EmptyStateArchive /> : <AuthEmptyState onNew={() => setShowNew(true)} disabled={readOnly} />;
    }

    return <AuthGrid records={records} onEdit={setEditing} onExport={setExporting} onDelete={setDeleting} />;
  };

  const banner = () => {
    if (vault.phase !== 'ready') return null;
    if (vault.syncState === 'signed-out') {
      return <p className={s.banner}>Sync is paused — sign in again to add or change credentials.</p>;
    }
    if (vault.syncState === 'offline' || vault.syncState === 'error') {
      return <p className={s.banner}>Offline. Codes keep working; changes need a connection.</p>;
    }
    if (vault.clockSuspect) {
      return (
        <p className={s.bannerWarn}>
          This device&rsquo;s clock is out by more than {Math.round(Math.abs(vault.serverTimeOffsetMs) / 1000)}s. Codes
          may be rejected until it is corrected.
        </p>
      );
    }
    if (!vault.trusted) {
      return (
        <p className={s.banner}>
          This device is not trusted — codes are available for this visit only.{' '}
          <button type="button" className={s.bannerAction} onClick={() => void handleEnroll(true)}>
            Trust this device
          </button>
        </p>
      );
    }
    return null;
  };

  return (
    <div className={`${s.page} ph-no-capture`}>
      {archived ? (
        <ArchivePageHeader title="Archived Auth" backHref="/auth" backLabel="Auth" BackIcon="auth" />
      ) : (
        <PageHeader
          title="Auth"
          showSearch={false}
          actions={
            vault.phase === 'ready' ? (
              <>
                {records.length > 0 && (
                  <span className={s.clock} data-testid="auth-clock">
                    refresh in {headerSeconds}s
                  </span>
                )}
                <Link href="/auth/archive" className="mr-2">
                  <Button variant="ghost" size="icon" aria-label="Archive" title="Archive">
                    <Archive size={18} />
                  </Button>
                </Link>
                <Button
                  variant="default"
                  onClick={() => setShowNew(true)}
                  disabled={readOnly}
                  title={readOnly ? 'Reconnect to add a credential' : undefined}
                  data-testid="auth-new"
                >
                  <SquarePlus size={18} />
                  New auth
                </Button>
              </>
            ) : undefined
          }
        />
      )}

      {banner()}
      {body()}

      {PassphraseGuard}

      {showNew && <NewAuthModal onClose={() => setShowNew(false)} />}

      {editing?.secrets && (
        <EditAuthDialog
          secrets={editing.secrets}
          onSave={(next) => vault.updateSecrets(editing.id, next)}
          onClose={() => setEditing(null)}
        />
      )}

      {exporting?.secrets && <ExportAuthDialog secrets={exporting.secrets} onClose={() => setExporting(null)} />}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this credential?</AlertDialogTitle>
            <AlertDialogDescription>
              The setup key for {deleting?.secrets?.issuer || deleting?.secrets?.account || 'this credential'} is
              deleted from every device. It cannot be recovered — you would have to set the credential up again with the
              service.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting;
                if (!target) return;
                vault
                  .remove(target.id)
                  .then(() => toast.success('Credential deleted'))
                  .catch(() => toast.error('Could not delete the credential'));
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
