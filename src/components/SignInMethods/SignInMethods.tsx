'use client';

import React from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { HTTPError } from 'ky';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
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

  const PROVIDERS = [
    { id: 'google', label: 'Google', icon: <GoogleIcon />, onConnect: handleLinkGoogle },
    { id: 'siwe', label: 'Ethereum', icon: <EthereumIcon className="p-px" />, onConnect: handleLinkSiwe },
  ];

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
            {PROVIDERS.map((provider, i) => {
              const identity = identities?.find((id) => id.provider === provider.id);
              const isLinked = !!identity;
              return (
                <React.Fragment key={provider.id}>
                  {i > 0 && <div className={s.divider} />}
                  <div className={s.identityRow} data-testid={`identity-${provider.id}`}>
                    <div className={s.identityIcon}>{provider.icon}</div>
                    <div className={s.identityInfo}>
                      <span className={s.identityLabel}>{provider.label}</span>
                      {isLinked && (
                        <span className={s.identitySubject}>
                          {provider.id === 'google'
                            ? (identity.email ?? identity.providerSubject)
                            : shortenAddress(identity.providerSubject)}
                        </span>
                      )}
                    </div>
                    {isLinked ? (
                      isOnlyOne ? (
                        <TooltipOrPopover
                          trigger={
                            <span tabIndex={0} className={s.tooltipWrapper}>
                              <Button variant="outline" size="sm" disabled data-testid={`unlink-${provider.id}`}>
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
                          onClick={() => handleUnlink(provider.id)}
                          data-testid={`unlink-${provider.id}`}
                        >
                          {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : null}
                          Unlink
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={provider.id === 'siwe' && siweStep !== 'idle'}
                        onClick={provider.onConnect}
                        data-testid={`connect-${provider.id}`}
                      >
                        {provider.id === 'siwe' && siweStep === 'connecting'
                          ? 'Connecting…'
                          : provider.id === 'siwe' && siweStep === 'signing'
                            ? 'Sign in wallet…'
                            : 'Connect'}
                      </Button>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
