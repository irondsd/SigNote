'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, Copy, KeyRound, NotebookText, BookLock, SquareAsterisk, Trash2, ShieldOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useProfile } from '@/hooks/useProfile';
import useCopy from '@/hooks/useCopy';
import s from './page.module.scss';

function StatItem({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  value: number | undefined;
  testId: string;
}) {
  return (
    <div className={s.statItem}>
      <Icon size={20} strokeWidth={1.6} className={s.statIcon} />
      <span className={s.statValue} data-testid={testId}>
        {value ?? '—'}
      </span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile, isLoading } = useProfile();
  const { isCopied, copy } = useCopy(profile?.address ?? '');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  const joinedDate = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className={s.container}>
      <div className={s.content}>
        {/* Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className={s.overviewBody}>
            <div className={s.addressRow}>
              <span data-testid="profile-address" className={s.address}>
                {profile?.address ?? session.user.address}
              </span>
              <Button variant="ghost" size="icon-xs" onClick={copy} title="Copy address" disabled={!profile?.address}>
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            {joinedDate && (
              <p className={s.joinedDate}>
                Member since <strong>{joinedDate}</strong>
              </p>
            )}
            {isLoading && !joinedDate && <p className={s.joinedDate}>Loading…</p>}
          </CardContent>
        </Card>

        {/* Statistics */}
        <Card>
          <CardHeader>
            <CardTitle>Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={s.statsGrid}>
              <StatItem icon={NotebookText} label="Notes" value={profile?.notesCount} testId="notes-count" />
              <StatItem icon={SquareAsterisk} label="Secrets" value={profile?.secretsCount} testId="secrets-count" />
              <StatItem icon={BookLock} label="Seals" value={profile?.sealsCount} testId="seals-count" />
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Passphrase</span>
                <span className={s.actionDesc}>Change the passphrase used to protect your secrets and seals.</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push('/change-passphrase')}>
                <KeyRound size={14} />
                Change
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className={s.dangerCard}>
          <CardHeader>
            <CardTitle className={s.dangerTitle}>Danger Zone</CardTitle>
          </CardHeader>
          <CardContent className={s.dangerBody}>
            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Erase encryption profile</span>
                <span className={s.actionDesc}>
                  Permanently removes your encryption profile. All secrets and seals will be deleted and cannot be
                  recovered.
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={profile?.hasEncryptionProfile ? undefined : 0} className={s.tooltipWrapper}>
                    <Button
                      data-testid="erase-profile-btn"
                      variant="destructive"
                      size="sm"
                      disabled={!profile?.hasEncryptionProfile}
                    >
                      <ShieldOff size={14} />
                      Erase
                    </Button>
                  </span>
                </TooltipTrigger>
                {!profile?.hasEncryptionProfile && (
                  <TooltipContent side="left">No encryption profile set up</TooltipContent>
                )}
              </Tooltip>
            </div>

            <div className={s.divider} />

            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Delete account</span>
                <span className={s.actionDesc}>
                  Permanently deletes your account and all associated data including notes, secrets, and seals.
                </span>
              </div>
              <Button variant="destructive" size="sm">
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
