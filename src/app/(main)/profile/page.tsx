'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  Save,
  KeyRound,
  Loader2,
  Pencil,
  Trash2,
  ShieldOff,
  ShieldCheck,
  Download,
  LifeBuoy,
  MonitorSmartphone,
  Tag as TagIcon,
  Bell,
  UserRound,
  Info,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { InlineSvg } from '@irondsd/inline-svg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useProfile, useUpdateDisplayName, type TierCounts } from '@/hooks/useProfile';
import { useTags } from '@/hooks/useTags';
import { SignInMethods } from '@/components/SignInMethods/SignInMethods';
import { useSecurityPreferences, useUpdateSecurityPreferences } from '@/hooks/useSecurityPreferences';
import { useRotationAvailability } from '@/hooks/useRotationAvailability';
import s from './page.module.scss';
import Link from 'next/link';
import { announceVaultRemoval, loadVault, removeVault } from '@/lib/otpStore';

// The same four icons the nav uses, so a tile reads as the section it counts.
const STATS = [
  { key: 'notes', label: 'Notes', icon: 'notes.svg' },
  { key: 'secrets', label: 'Secrets', icon: 'secrets.svg' },
  { key: 'seals', label: 'Seals', icon: 'seals.svg' },
  { key: 'auth', label: 'Auth', icon: 'auth.svg' },
] as const;

function StatItem({
  icon,
  label,
  counts,
  testId,
  isLoading,
}: {
  icon: string;
  label: string;
  counts: TierCounts | undefined;
  testId: string;
  isLoading?: boolean;
}) {
  return (
    <div className={s.statItem}>
      <InlineSvg src={`/icons/${icon}`} className={s.statIcon} />
      <span className={s.statValue} data-testid={`${testId}-count`}>
        {isLoading && counts === undefined ? <Loader2 size={20} className={s.spinner} /> : (counts?.active ?? '—')}
      </span>
      <span className={s.statLabel}>{label}</span>
      {/* Always rendered, faded out at zero: the tiles keep the same height and
          the count stays readable to tests either way. */}
      <span className={`${s.statArchived} ${counts?.archived ? '' : s.statArchivedEmpty}`}>
        <span data-testid={`${testId}-archived-count`}>{counts?.archived ?? 0}</span> archived
      </span>
    </div>
  );
}

/**
 * One security switch: what it does, and — behind the info icon — what it costs.
 * Both of these are trades rather than features, so the row that offers one has
 * to be able to state the downside without the description becoming a paragraph.
 */
function SecurityPreferenceRow({
  label,
  description,
  moreInfo,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  description: string;
  moreInfo: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  return (
    <div className={s.actionRow}>
      <div className={s.actionInfo}>
        <span className={`${s.actionLabel} ${s.prefLabel}`}>
          {label}
          <TooltipOrPopover
            trigger={
              <button
                type="button"
                className={s.infoTrigger}
                aria-label={`About: ${label}`}
                data-testid={`${testId}-info`}
              >
                <Info size={14} />
              </button>
            }
            side="top"
          >
            <span className={s.infoTooltip}>{moreInfo}</span>
          </TooltipOrPopover>
        </span>
        <span className={s.actionDesc}>{description}</span>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
        data-testid={testId}
      />
    </div>
  );
}

function ProfilePageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: profile, isLoading } = useProfile();
  const { tags, isLoading: tagsLoading } = useTags();
  const { mutate: updateDisplayName, isPending: isSaving } = useUpdateDisplayName();
  const { data: security, isLoading: securityLoading } = useSecurityPreferences();
  const { data: rotation } = useRotationAvailability();
  const { mutate: updateSecurity } = useUpdateSecurityPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [trustedAuthenticator, setTrustedAuthenticator] = useState(false);
  const [confirmForgetAuth, setConfirmForgetAuth] = useState(false);
  const [forgettingAuth, setForgettingAuth] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    const userId = session?.user?.id;
    let cancelled = false;
    if (status !== 'authenticated' || !userId) {
      setTrustedAuthenticator(false);
      return;
    }
    void loadVault(userId)
      .then((vault) => {
        if (!cancelled) setTrustedAuthenticator(vault !== null);
      })
      .catch(() => {
        if (!cancelled) setTrustedAuthenticator(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, session?.user?.id]);

  const forgetAuthenticator = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    setForgettingAuth(true);
    try {
      await removeVault(userId);
      announceVaultRemoval(userId);
      setTrustedAuthenticator(false);
      setConfirmForgetAuth(false);
      toast.success('This device no longer stores your Authenticator key.');
    } catch {
      toast.error('Could not forget the Authenticator on this device. Try again.');
    } finally {
      setForgettingAuth(false);
    }
  };

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

  // `users.email` is only ever set on proof of control, so this is exactly
  // "is there somewhere we could send mail". An identity's own email column
  // isn't — Google reports one whether or not it verified it.
  const hasEmail = Boolean(profile?.email);

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
              <div className={s.profileSummary}>
                <div className={`${s.skeleton} ${s.skeletonAvatar}`} />
                <div className={s.profileIdentity}>
                  <div className={`${s.skeleton} ${s.skeletonLabel}`} />
                  <div className={`${s.skeleton} ${s.skeletonDisplayName}`} />
                  <div className={`${s.skeleton} ${s.skeletonJoinedDate}`} />
                </div>
              </div>
            ) : (
              <div className={s.profileSummary}>
                <div className={s.profileAvatar} aria-hidden="true">
                  <UserRound />
                </div>
                <div className={s.profileIdentity}>
                  <span className={s.identityLabel}>Display name</span>
                  {isEditing ? (
                    <div className={s.nameEditor}>
                      <Input
                        className={s.nameInput}
                        value={editValue}
                        maxLength={50}
                        autoFocus
                        disabled={isSaving}
                        aria-label="Display name"
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
                      <div className={s.nameEditorActions}>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isSaving || !editValue.trim() || editValue.trim() === profile?.displayName}
                          onClick={() => {
                            updateDisplayName(editValue.trim(), {
                              onSuccess: () => setIsEditing(false),
                              onError: () => toast.error('Failed to update display name.'),
                            });
                          }}
                          aria-label="Save display name"
                        >
                          {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => setIsEditing(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={s.nameRow}>
                      <span data-testid="profile-address" className={s.displayName}>
                        {profile?.displayName}
                      </span>
                      {profile && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={s.editBtn}
                          onClick={() => {
                            setEditValue(profile.displayName);
                            setIsEditing(true);
                          }}
                          aria-label="Edit display name"
                        >
                          <Pencil />
                        </Button>
                      )}
                    </div>
                  )}
                  {joinedDate && (
                    <p className={s.joinedDate}>
                      Member since <strong>{joinedDate}</strong>
                    </p>
                  )}
                </div>
              </div>
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
              {STATS.map(({ key, label, icon }) => (
                <StatItem
                  key={key}
                  icon={icon}
                  label={label}
                  counts={profile?.counts[key]}
                  testId={key}
                  isLoading={isLoading}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Security preferences */}
        <Card data-testid="security-prefs-section">
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent className={s.securityPrefsBody}>
            {securityLoading || !security ? (
              <>
                <div className={`${s.skeleton} ${s.skeletonRow}`} />
                <div className={`${s.skeleton} ${s.skeletonRow}`} />
              </>
            ) : (
              <>
                <SecurityPreferenceRow
                  testId="pref-cache-server-share"
                  label="Unlock without a network"
                  description="Keep part of your encryption key on this device so secrets and seals open while offline."
                  moreInfo={
                    'Your key is split in two: one half comes from your passphrase, the other is held by the server ' +
                    'and normally never touches the device. Turning this on stores that server half locally, so ' +
                    'anyone who takes the device only has to guess your passphrase to reach your data — instead of ' +
                    'needing your account too. Off by default.'
                  }
                  checked={security.cacheServerShare}
                  onChange={(checked) => updateSecurity({ cacheServerShare: checked })}
                />

                <div className={s.divider} />

                <SecurityPreferenceRow
                  testId="pref-blur-auth-codes"
                  label="Blur Authenticator codes"
                  description="Hide codes until you point at the card. Applies to screens with a mouse; a phone shows them as usual."
                  moreInfo={
                    'Keeps one-time codes out of screenshots, screen shares and the view over your shoulder. ' +
                    'Hovering a card reveals its code, and clicking still copies it without revealing anything.'
                  }
                  checked={security.blurAuthCodes}
                  onChange={(checked) => updateSecurity({ blurAuthCodes: checked })}
                />

                {security.cacheServerShare && (
                  <p className={`${s.actionDesc} ${s.prefWarning}`} data-testid="cache-server-share-warning">
                    <ShieldAlert size={13} /> This account&apos;s key half is stored on every device you sign in from
                    until you turn this off.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Sign-in Methods */}
        <SignInMethods />

        {/* Active sessions */}
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Active sessions</span>
                <span className={s.actionDesc}>
                  See where you&apos;re signed in and sign out of devices you no longer use.
                </span>
              </div>
              <Link href="/sessions">
                <Button variant="outline" size="sm" data-testid="manage-sessions-btn">
                  <MonitorSmartphone size={14} />
                  Manage
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* A memory-only Authenticator session has nothing stored to manage,
            so this section exists only for a genuinely trusted device. */}
        {trustedAuthenticator && (
          <Card data-testid="auth-device-section">
            <CardHeader>
              <CardTitle>Authenticator</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={s.actionRow}>
                <div className={s.actionInfo}>
                  <span className={s.actionLabel}>Trusted on this device</span>
                  <span className={s.actionDesc}>
                    This browser stores your Authenticator key so codes work offline. Forgetting it removes the local
                    key and cache; your synced credentials stay in your account.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmForgetAuth(true)}
                  data-testid="forget-auth-device-btn"
                >
                  <ShieldOff size={14} />
                  Forget this device
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tags */}
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>
                  Existing tags: <strong data-testid="tags-count">{tagsLoading ? '…' : tags.length}</strong>
                </span>
                <span className={s.actionDesc}>Rename, recolor or remove the tags you use to organize your notes.</span>
              </div>
              <Link href="/tags">
                <Button variant="outline" size="sm" data-testid="manage-tags-btn">
                  <TagIcon size={14} />
                  Manage
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Email notifications</span>
                <span className={s.actionDesc}>
                  Choose which emails SigNote sends you. Sign-in codes are always sent.
                </span>
              </div>
              {hasEmail ? (
                <Link href="/notifications">
                  <Button variant="outline" size="sm" data-testid="manage-notifications-btn">
                    <Bell size={14} />
                    Manage
                  </Button>
                </Link>
              ) : (
                <TooltipOrPopover
                  trigger={
                    <span tabIndex={0} className={s.tooltipWrapper}>
                      <Button variant="outline" size="sm" disabled data-testid="manage-notifications-btn">
                        <Bell size={14} />
                        Manage
                      </Button>
                    </span>
                  }
                  side="left"
                >
                  No email address on this account
                </TooltipOrPopover>
              )}
            </div>
          </CardContent>
        </Card>

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
                <Button variant="outline" size="sm" onClick={() => router.push('/change-passphrase')}>
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

            <div className={s.divider} />

            {/* Offered when the feature is available, and also whenever an
                operation already exists — turning the feature off must never
                strand an account mid-rotation with no way back to it. */}
            {profile?.hasEncryptionProfile && (rotation?.rotationAvailable || rotation?.rotationInProgress) && (
              <>
                <div className={s.actionRow}>
                  <div className={s.actionInfo}>
                    <span className={s.actionLabel}>Encryption keys</span>
                    <span className={s.actionDesc}>
                      {rotation.rotationInProgress
                        ? 'A key rotation is in progress. Continue or cancel it.'
                        : 'Replace every encryption key and re-encrypt all of your encrypted data.'}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/rotate-keys')}
                    data-testid="profile-rotate-keys"
                  >
                    <RefreshCw size={14} />
                    {rotation.rotationInProgress ? 'Continue' : 'Rotate'}
                  </Button>
                </div>

                <div className={s.divider} />
              </>
            )}

            <div className={s.actionRow}>
              <div className={s.actionInfo}>
                <span className={s.actionLabel}>Backup recovery file</span>
                <span className={s.actionDesc}>
                  Download a recovery file so you can regain access if you forget your passphrase.
                </span>
              </div>
              {profile?.hasEncryptionProfile ? (
                <Button variant="outline" size="sm" onClick={() => router.push('/backup-recovery')}>
                  <Download size={14} />
                  Backup
                </Button>
              ) : (
                <TooltipOrPopover
                  trigger={
                    <span tabIndex={0} className={s.tooltipWrapper}>
                      <Button variant="outline" size="sm" disabled>
                        <Download size={14} />
                        Backup
                      </Button>
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
                <span className={s.actionLabel}>Recover access</span>
                <span className={s.actionDesc}>Lost your passphrase? Use a recovery file to regain access.</span>
              </div>
              {profile?.hasEncryptionProfile ? (
                <Button variant="outline" size="sm" onClick={() => router.push('/recover')}>
                  <LifeBuoy size={14} />
                  Recover
                </Button>
              ) : (
                <TooltipOrPopover
                  trigger={
                    <span tabIndex={0} className={s.tooltipWrapper}>
                      <Button variant="outline" size="sm" disabled>
                        <LifeBuoy size={14} />
                        Recover
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
                  Permanently deletes your encryption profile, all secrets and seals, and all synced Authenticator
                  credentials. This cannot be recovered.
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
                  Permanently deletes your account and all associated data, including notes, secrets, seals, and
                  Authenticator credentials.
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

        <AlertDialog open={confirmForgetAuth} onOpenChange={setConfirmForgetAuth}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Forget Authenticator on this device?</AlertDialogTitle>
              <AlertDialogDescription>
                Offline codes will stop working in this browser. Your encrypted credentials remain synced, and you can
                trust this device again later with your passphrase.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={forgettingAuth}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={forgettingAuth}
                onClick={(event) => {
                  event.preventDefault();
                  void forgetAuthenticator();
                }}
              >
                {forgettingAuth ? 'Forgetting…' : 'Forget device'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
