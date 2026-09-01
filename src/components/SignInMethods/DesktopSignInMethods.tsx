'use client';

import { Loader2 } from 'lucide-react';
import { HTTPError } from 'ky';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GoogleIcon } from '@/components/icons/SignInIcons';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useIdentities, useUnlinkIdentity } from '@/hooks/useIdentities';
import { SignInMethodsSkeleton } from './SignInMethodsSkeleton';
import s from './SignInMethods.module.scss';

export function DesktopSignInMethods() {
  const { data: identities, isLoading } = useIdentities();
  const { mutate: unlink, isPending: isUnlinking } = useUnlinkIdentity();
  const googleIdentity = identities?.find((identity) => identity.provider === 'google');
  const isOnlyIdentity = (identities?.length ?? 0) <= 1;

  const handleUnlink = () => {
    unlink('google', {
      onSuccess: () => toast.success('Sign-in method removed.'),
      onError: async (error: unknown) => {
        const body =
          error instanceof HTTPError
            ? ((await error.response.json().catch(() => ({}))) as { error?: string })
            : undefined;
        toast.error(
          body?.error === 'LAST_IDENTITY'
            ? 'You must keep at least one sign-in method.'
            : 'Failed to remove sign-in method.',
        );
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in Method</CardTitle>
      </CardHeader>
      <CardContent className={s.body}>
        {isLoading ? (
          <SignInMethodsSkeleton rows={1} />
        ) : (
          <div className={s.identityRow} data-testid="identity-google">
            <div className={s.identityIcon}>
              <GoogleIcon />
            </div>
            <div className={s.identityInfo}>
              <span className={s.identityLabel}>Google</span>
              <span className={s.identitySubject}>
                {googleIdentity?.email ?? googleIdentity?.providerSubject ?? 'Not linked'}
              </span>
            </div>
            {googleIdentity &&
              (isOnlyIdentity ? (
                <TooltipOrPopover
                  trigger={
                    <span tabIndex={0} className={s.tooltipWrapper}>
                      <Button variant="outline" size="sm" disabled data-testid="unlink-google">
                        Unlink
                      </Button>
                    </span>
                  }
                  side="left"
                >
                  You must keep at least one sign-in method
                </TooltipOrPopover>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isUnlinking}
                  onClick={handleUnlink}
                  data-testid="unlink-google"
                >
                  {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : null}
                  Unlink
                </Button>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
