'use client';

import { Loader2 } from 'lucide-react';
import { HTTPError } from 'ky';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EthereumIcon, GoogleIcon } from '@/components/icons/SignInIcons';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useIdentities, useUnlinkIdentity } from '@/hooks/useIdentities';
import { useSiweSign } from '@/hooks/useSiweSign';
import { api } from '@/lib/api';
import { shortenAddress } from '@/utils/shortenAddress';
import { SignInMethodsSkeleton } from './SignInMethodsSkeleton';
import s from './SignInMethods.module.scss';

export function DesktopSignInMethods() {
  const { data: identities, isLoading } = useIdentities();
  const { mutate: unlink, isPending: isUnlinking } = useUnlinkIdentity();
  const { sign, step: siweStep } = useSiweSign();
  const googleIdentity = identities?.find((identity) => identity.provider === 'google');
  const siweIdentity = identities?.find((identity) => identity.provider === 'siwe');
  const isOnlyIdentity = (identities?.length ?? 0) <= 1;

  const getApiErrorCode = async (error: unknown) => {
    if (!(error instanceof HTTPError)) return null;
    const body = (await error.response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? null;
  };

  const handleUnlink = (provider: 'google' | 'siwe') => {
    unlink(provider, {
      onSuccess: () => toast.success('Sign-in method removed.'),
      onError: async (error: unknown) => {
        const errorCode = await getApiErrorCode(error);
        toast.error(
          errorCode === 'LAST_IDENTITY'
            ? 'You must keep at least one sign-in method.'
            : 'Failed to remove sign-in method.',
        );
      },
    });
  };

  const handleLinkSiwe = async () => {
    const result = await sign();
    if (!result) return;

    try {
      await api.post('/api/auth/link/siwe', { json: { message: result.message, signature: result.signature } }).json();
      toast.success('Ethereum wallet linked successfully.');
      window.location.reload();
    } catch (error: unknown) {
      const errorCode = await getApiErrorCode(error);
      if (errorCode === 'CONFLICT_ENCRYPTED_DATA') {
        toast.error(
          'This wallet has encrypted data (secrets or seals). Sign in to that account, erase its encryption profile under Danger Zone, then try again.',
          { duration: 8000 },
        );
      } else if (errorCode === 'ALREADY_LINKED') {
        toast.error('This wallet is already connected to a different account.');
      } else {
        toast.error('Failed to link wallet. Please try again.');
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in Methods</CardTitle>
      </CardHeader>
      <CardContent className={s.body}>
        {isLoading ? (
          <SignInMethodsSkeleton rows={2} />
        ) : (
          <>
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
                    onClick={() => handleUnlink('google')}
                    data-testid="unlink-google"
                  >
                    {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : null}
                    Unlink
                  </Button>
                ))}
            </div>

            <div className={s.divider} />

            <div className={s.identityRow} data-testid="identity-siwe">
              <div className={s.identityIcon}>
                <EthereumIcon className="p-px" />
              </div>
              <div className={s.identityInfo}>
                <span className={s.identityLabel}>Ethereum</span>
                {siweIdentity && (
                  <span className={s.identitySubject}>{shortenAddress(siweIdentity.providerSubject)}</span>
                )}
              </div>
              {siweIdentity ? (
                isOnlyIdentity ? (
                  <TooltipOrPopover
                    trigger={
                      <span tabIndex={0} className={s.tooltipWrapper}>
                        <Button variant="outline" size="sm" disabled data-testid="unlink-siwe">
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
                    onClick={() => handleUnlink('siwe')}
                    data-testid="unlink-siwe"
                  >
                    {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : null}
                    Unlink
                  </Button>
                )
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={siweStep !== 'idle'}
                  onClick={handleLinkSiwe}
                  data-testid="connect-siwe"
                >
                  {siweStep === 'connecting' ? 'Connecting…' : siweStep === 'signing' ? 'Sign in wallet…' : 'Connect'}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
