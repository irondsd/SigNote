'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Info, KeyRound, Loader2, LogIn, MailX, Megaphone } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import {
  useNotificationSettings,
  useUpdateNotificationSettings,
  type NotificationPatch,
} from '@/hooks/useNotificationSettings';
import s from './page.module.scss';

type SectionProps = {
  icon: React.ElementType;
  label: string;
  description: string;
  checked: boolean;
  /** Set for the section that can't be turned off; explains why. */
  lockedReason?: string;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  testId: string;
};

function Section({ icon: Icon, label, description, checked, lockedReason, disabled, onChange, testId }: SectionProps) {
  const control = (
    <Switch
      checked={checked}
      disabled={disabled || Boolean(lockedReason)}
      onCheckedChange={onChange}
      aria-label={label}
      data-testid={testId}
    />
  );

  return (
    <div className={s.row}>
      <div className={s.rowInfo}>
        <span className={s.rowLabel}>
          <Icon size={15} strokeWidth={1.8} />
          {label}
          {lockedReason && <span className={s.lockedBadge}>Always on</span>}
        </span>
        <span className={s.rowDesc}>{description}</span>
      </div>
      <div className={s.rowControl}>
        {lockedReason ? (
          <TooltipOrPopover
            trigger={
              <span tabIndex={0} className={s.tooltipWrapper}>
                {control}
              </span>
            }
            side="left"
          >
            {lockedReason}
          </TooltipOrPopover>
        ) : (
          control
        )}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { data: settings, isLoading } = useNotificationSettings();
  const { mutate: update, isPending } = useUpdateNotificationSettings();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  const set = (patch: NotificationPatch) => update(patch);
  const allOff = settings ? !settings.productNews && !settings.signInAlerts : false;

  return (
    <div className={s.container}>
      <div className={s.content}>
        <Card>
          <CardHeader>
            <CardTitle>Email notifications</CardTitle>
          </CardHeader>
          <CardContent className={s.body}>
            {isLoading || !settings ? (
              <>
                <div className={`${s.skeleton} ${s.skeletonRow}`} />
                <div className={`${s.skeleton} ${s.skeletonRow}`} />
                <div className={`${s.skeleton} ${s.skeletonRow}`} />
              </>
            ) : (
              <>
                {settings.email ? (
                  <p className={s.recipient}>
                    Sent to <span className={s.recipientAddress}>{settings.email}</span>
                  </p>
                ) : (
                  <div className={s.notice}>
                    <Info size={15} className={s.noticeIcon} />
                    <span>
                      Your account has no email address, so nothing can be sent yet. These preferences are saved and
                      will apply as soon as one is added —{' '}
                      <Link href="/profile" className={s.noticeLink}>
                        link a Google account
                      </Link>{' '}
                      to receive email.
                    </span>
                  </div>
                )}

                <div className={s.divider} />

                <Section
                  icon={Megaphone}
                  label="Product news"
                  description="Occasional notes about new features and releases. No more than a few a year."
                  checked={settings.productNews}
                  disabled={isPending}
                  onChange={(checked) => set({ productNews: checked })}
                  testId="pref-product-news"
                />

                <div className={s.divider} />

                <Section
                  icon={LogIn}
                  label="New sign-ins"
                  description="A heads-up when your account is opened on a device or browser we haven't seen before."
                  checked={settings.signInAlerts}
                  disabled={isPending}
                  onChange={(checked) => set({ signInAlerts: checked })}
                  testId="pref-sign-in-alerts"
                />

                <div className={s.divider} />

                <Section
                  icon={KeyRound}
                  label="Sign-in codes"
                  description="The one-time codes you enter to sign in. Listed here for completeness — this one can't be switched off."
                  checked
                  lockedReason="Turning this off would lock you out of your own account."
                  testId="pref-sign-in-codes"
                />
              </>
            )}
          </CardContent>
        </Card>

        {settings && (
          <Card>
            <CardHeader>
              <CardTitle>Unsubscribe</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={s.footerRow}>
                <div className={s.rowInfo}>
                  <span className={s.rowLabel}>Turn off every optional email</span>
                  <span className={s.rowDesc}>
                    Switches off product news and sign-in alerts in one go. Sign-in codes keep working.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={allOff || isPending}
                  onClick={() => set({ productNews: false, signInAlerts: false })}
                  data-testid="unsubscribe-all-btn"
                >
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : <MailX size={14} />}
                  {allOff ? 'All off' : 'Unsubscribe from all'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
