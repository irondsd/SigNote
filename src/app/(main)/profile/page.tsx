'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  Save,
  KeyRound,
  Loader2,
  NotebookText,
  BookLock,
  Pencil,
  SquareAsterisk,
  Trash2,
  ShieldOff,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useProfile, useUpdateDisplayName } from '@/hooks/useProfile';
import { SignInMethods } from '@/components/SignInMethods/SignInMethods';
import s from './page.module.scss';
import Link from 'next/link';

function StatItem({
  icon: Icon,
  label,
  value,
  testId,
  isLoading,
}: {
  icon: React.ElementType;
  label: string;
  value: number | undefined;
  testId: string;
  isLoading?: boolean;
}) {
  return (
    <div className={s.statItem}>
      <Icon size={20} strokeWidth={1.6} className={s.statIcon} />
      <span className={s.statValue} data-testid={testId}>
        {isLoading && value === undefined ? <Loader2 size={20} className={s.spinner} /> : (value ?? '—')}
      </span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}

function ProfilePageContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: profile, isLoading } = useProfile();
  const { mutate: updateDisplayName, isPending: isSaving } = useUpdateDisplayName();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    const linked = searchParams.get('linked');
    const linkError = searchParams.get('link_error');

    if (linked === 'google') {
      toast.success('Google account linked successfully.');
    } else if (linked === 'siwe') {
      toast.success('Ethereum wallet linked successfully.');
    } else if (linkError === 'encrypted_data') {
      toast.error(
        'This account has encrypted data (secrets or seals). Sign in to that account, erase its encryption profile under Danger Zone, then try again.',
        { duration: 8000 },
      );
    } else if (linkError === 'already_linked') {
      toast.error('This sign-in method is already connected to a different account.');
    } else if (linkError === 'cancelled') {
      // User cancelled — no toast
    } else if (linkError) {
      toast.error('Something went wrong while linking. Please try again.');
    }

    if (linked || linkError) {
      const url = new URL(window.location.href);
      url.searchParams.delete('linked');
      url.searchParams.delete('link_error');
      router.replace(url.pathname + (url.search || ''), { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status !== 'authenticated') return null;

  const joinedDate = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const encryptionSetupDate = profile?.encryptionProfileCreatedAt
    ? new Date(profile.encryptionProfileCreatedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
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
            {isLoading ? (
              <>
                <div className={`${s.skeleton} ${s.skeletonDisplayName}`} />
                <div className={`${s.skeleton} ${s.skeletonJoinedDate}`} />
              </>
            ) : (
              <>
                <div className={s.addressRow}>
                  {isEditing ? (
                    <div className={s.inputWrapper}>
                      <Input
                        className={s.inputWithIcon}
                        value={editValue}
                        maxLength={50}
                        autoFocus
                        disabled={isSaving}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setIsEditing(false);
                          if (e.key === 'Enter') {
                            const trimmed = editValue.trim();
                            if (trimmed && trimmed !== profile?.displayName) {
                              updateDisplayName(trimmed, {
                                onSuccess: () => setIsEditing(false),
                                onError: () => toast.error('Failed to update display name.'),
                              });
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground absolute inset-y-0 right-0 hover:bg-transparent"
                        disabled={isSaving || !editValue.trim() || editValue.trim() === profile?.displayName}
                        onClick={() => {
                          updateDisplayName(editValue.trim(), {
                            onSuccess: () => setIsEditing(false),
                            onError: () => toast.error('Failed to update display name.'),
                          });
                        }}
                        aria-label="Save display name"
                      >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span data-testid="profile-address" className={s.address}>
                        {profile?.displayName}
                      </span>
                      {profile && (
                        <button
                          className={s.editBtn}
                          onClick={() => {
                            setEditValue(profile.displayName);
                            setIsEditing(true);
                          }}
                          aria-label="Edit display name"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {joinedDate && (
                  <p className={s.joinedDate}>
                    Member since <strong>{joinedDate}</strong>
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Statistics */}
        <Card>
          <CardHeader>
            <CardTitle>Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={s.statsGrid}>
              <StatItem
                icon={NotebookText}
                label="Notes"
                value={profile?.notesCount}
                testId="notes-count"
                isLoading={isLoading}
              />
              <StatItem
                icon={SquareAsterisk}
                label="Secrets"
                value={profile?.secretsCount}
                testId="secrets-count"
                isLoading={isLoading}
              />
              <StatItem
                icon={BookLock}
                label="Seals"
                value={profile?.sealsCount}
                testId="seals-count"
                isLoading={isLoading}
              />
            </div>
          </CardContent>
        </Card>

        {/* Sign-in Methods */}
        <SignInMethods />

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle>Encryption</CardTitle>
          </CardHeader>
          <CardContent className={s.securityBody}>
            {isLoading ? (
              <div className={s.encryptionStatus}>
                <div className={`${s.skeleton} ${s.skeletonIcon}`} />
                <div className={s.encryptionStatusInfo}>
                  <div className={`${s.skeleton} ${s.skeletonLabelSm}`} />
                  <div className={`${s.skeleton} ${s.skeletonDescSm}`} />
                </div>
              </div>
            ) : (
              <div className={s.encryptionStatus}>
                {encryptionSetupDate ? (
                  <ShieldCheck size={16} className={s.encryptionSetupIcon} />
                ) : (
                  <ShieldOff size={16} className={s.encryptionOffIcon} />
                )}
                <div className={s.encryptionStatusInfo}>
                  <span className={s.actionLabel}>Encryption profile</span>
                  {encryptionSetupDate ? (
                    <span className={s.actionDesc}>
                      Set up on <strong>{encryptionSetupDate}</strong>
                    </span>
                  ) : (
                    <span className={s.actionDesc}>
                      Not set up ·{' '}
                      <Link href="/secrets" className={s.setupLink}>
                        Set up →
                      </Link>
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className={s.divider} />

            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Passphrase</span>
                <span className={s.actionDesc}>Change the passphrase used to protect your secrets and seals.</span>
              </div>
              {profile?.hasEncryptionProfile ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/change-passphrase')}
                >
                  <KeyRound size={14} />
                  Change
                </Button>
              ) : (
                <TooltipOrPopover
                  trigger={
                    <span tabIndex={0} className={s.tooltipWrapper}>
                      <Button variant="outline" size="sm" disabled>
                        <KeyRound size={14} />
                        Change
                      </Button>
                    </span>
                  }
                  side="left"
                >
                  No encryption profile set up
                </TooltipOrPopover>
              )}
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
              {profile?.hasEncryptionProfile ? (
                <Link href="/erase-encryption">
                  <Button data-testid="erase-profile-btn" variant="destructive" size="sm">
                    <ShieldOff size={14} />
                    Erase
                  </Button>
                </Link>
              ) : (
                <TooltipOrPopover
                  trigger={
                    <span tabIndex={0} className={s.tooltipWrapper}>
                      <Link href="/erase-encryption">
                        <Button data-testid="erase-profile-btn" variant="destructive" size="sm" disabled>
                          <ShieldOff size={14} />
                          Erase
                        </Button>
                      </Link>
                    </span>
                  }
                  side="left"
                >
                  No encryption profile set up
                </TooltipOrPopover>
              )}
            </div>

            <div className={s.divider} />

            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Delete account</span>
                <span className={s.actionDesc}>
                  Permanently deletes your account and all associated data including notes, secrets, and seals.
                </span>
              </div>
              <Link href="/erase">
                <Button variant="destructive" size="sm">
                  <Trash2 size={14} />
                  Delete
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePageContent />
    </Suspense>
  );
}
