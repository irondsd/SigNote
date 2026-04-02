'use client';

import React from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { HTTPError } from 'ky';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIdentities, useUnlinkIdentity } from '@/hooks/useIdentities';
import { useSiweSign } from '@/hooks/useSiweSign';
import { shortenAddress } from '@/utils/shortenAddress';
import { api } from '@/lib/api';
import { EthereumIcon, GoogleIcon } from '@/components/icons/SignInIcons';
import s from './SignInMethods.module.scss';

export function SignInMethods() {
  const { data: identities, isLoading } = useIdentities();
  const { mutate: unlink, isPending: isUnlinking } = useUnlinkIdentity();
  const { sign, step: siweStep } = useSiweSign();

  const hasGoogle = identities?.some((id) => id.provider === 'google');
  const hasSiwe = identities?.some((id) => id.provider === 'siwe');
  const isOnlyOne = (identities?.length ?? 0) <= 1;

  const getApiErrorCode = async (err: unknown) => {
    if (!(err instanceof HTTPError)) return null;
    const body = (await err.response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? null;
  };

  const handleUnlink = (provider: string) => {
    unlink(provider, {
      onSuccess: () => toast.success('Sign-in method removed.'),
      onError: async (err: unknown) => {
        const errorCode = await getApiErrorCode(err);
        if (errorCode === 'LAST_IDENTITY') {
          toast.error('You must keep at least one sign-in method.');
        } else {
          toast.error('Failed to remove sign-in method.');
        }
      },
    });
  };

  const handleLinkGoogle = () => {
    window.location.href = '/api/auth/link/google/initiate';
  };

  const handleLinkSiwe = async () => {
    const result = await sign();
    if (!result) return;

    try {
      await api
        .post('/api/auth/link/siwe', {
          json: { message: result.message, signature: result.signature },
        })
        .json();
      toast.success('Ethereum wallet linked successfully.');
      // Reload to refresh identities
      window.location.reload();
    } catch (err: unknown) {
      const errorCode = await getApiErrorCode(err);
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
          <>
            <div className={s.identityRow}>
              <div className={`${s.identityIcon} ${s.skeletonIdentityIcon}`} />
              <div className={s.identityInfo}>
                <div className={`${s.skeleton} ${s.skeletonIdentityLabel}`} />
                <div className={`${s.skeleton} ${s.skeletonIdentitySubject}`} />
              </div>
              <div className={`${s.skeleton} ${s.skeletonButton}`} />
            </div>
            <div className={s.divider} />
            <div className={s.identityRow}>
              <div className={`${s.identityIcon} ${s.skeletonIdentityIcon}`} />
              <div className={s.identityInfo}>
                <div className={`${s.skeleton} ${s.skeletonIdentityLabel}`} />
                <div className={`${s.skeleton} ${s.skeletonIdentitySubject}`} />
              </div>
              <div className={`${s.skeleton} ${s.skeletonButton}`} />
            </div>
          </>
        ) : (
          <>
            {identities?.map((identity, i) => (
              <React.Fragment key={identity.provider}>
                {i > 0 && <div className={s.divider} />}
                <div className={s.identityRow} data-testid={`identity-${identity.provider}`}>
                  <div className={s.identityIcon}>
                    {identity.provider === 'google' ? <GoogleIcon /> : <EthereumIcon className="p-px" />}
                  </div>
                  <div className={s.identityInfo}>
                    <span className={s.identityLabel}>{identity.provider === 'google' ? 'Google' : 'Ethereum'}</span>
                    <span className={s.identitySubject}>
                      {identity.provider === 'google'
                        ? (identity.email ?? identity.providerSubject)
                        : shortenAddress(identity.providerSubject)}
                    </span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={isOnlyOne ? 0 : undefined} className={s.tooltipWrapper}>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isOnlyOne || isUnlinking}
                          onClick={() => handleUnlink(identity.provider)}
                          data-testid={`unlink-${identity.provider}`}
                        >
                          {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : null}
                          Unlink
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {isOnlyOne && (
                      <TooltipContent side="left">You must keep at least one sign-in method</TooltipContent>
                    )}
                  </Tooltip>
                </div>
              </React.Fragment>
            ))}

            {(!hasGoogle || !hasSiwe) && (
              <>
                {identities && identities.length > 0 && <div className={s.divider} />}
                <div className={s.linkSection}>
                  <span className={s.linkSectionLabel}>Add another sign-in method</span>
                  <div className={s.linkButtons}>
                    {!hasGoogle && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLinkGoogle}
                        className="justify-start gap-3"
                        data-testid="link-google-button"
                      >
                        <GoogleIcon />
                        Link Google account
                      </Button>
                    )}
                    {!hasSiwe && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLinkSiwe}
                        disabled={siweStep !== 'idle'}
                        className="justify-start gap-3"
                        data-testid="link-siwe-button"
                      >
                        <EthereumIcon className="p-px" />
                        {siweStep === 'connecting'
                          ? 'Connecting wallet…'
                          : siweStep === 'signing'
                            ? 'Sign in your wallet…'
                            : 'Link Ethereum wallet'}
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
