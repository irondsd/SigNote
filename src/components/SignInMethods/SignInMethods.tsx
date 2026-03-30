'use client';

import React from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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

  const handleUnlink = (provider: string) => {
    unlink(provider, {
      onSuccess: () => toast.success('Sign-in method removed.'),
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('LAST_IDENTITY')) {
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
      const body = err instanceof Error ? err.message : '';
      if (body.includes('CONFLICT_ENCRYPTED_DATA')) {
        toast.error(
          'This wallet has encrypted data (secrets or seals). Sign in to that account, erase its encryption profile under Danger Zone, then try again.',
          { duration: 8000 },
        );
      } else if (body.includes('ALREADY_LINKED')) {
        toast.error('This wallet is already connected to a different account.');
      } else {
        toast.error('Failed to link wallet. Please try again.');
      }
    }
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in Methods</CardTitle>
      </CardHeader>
      <CardContent className={s.body}>
        {identities?.map((identity, i) => (
          <React.Fragment key={identity.provider}>
            {i > 0 && <div className={s.divider} />}
            <div className={s.identityRow}>
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
                    >
                      {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : null}
                      Unlink
                    </Button>
                  </span>
                </TooltipTrigger>
                {isOnlyOne && <TooltipContent side="left">You must keep at least one sign-in method</TooltipContent>}
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
                  <Button variant="outline" size="sm" onClick={handleLinkGoogle} className="justify-start gap-3">
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
      </CardContent>
    </Card>
  );
}
