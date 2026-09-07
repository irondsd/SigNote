'use client';

import React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Fingerprint, Loader2 } from 'lucide-react';
import { HTTPError } from 'ky';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useDesktopApp } from '@/hooks/useDesktopApp';
import { useIdentities, useUnlinkIdentity } from '@/hooks/useIdentities';
import { useEmailMethod } from '@/hooks/useEmailAuth';
import { usePasskeys } from '@/hooks/usePasskeys';
import { useSiweSign } from '@/hooks/useSiweSign';
import { shortenAddress } from '@/utils/shortenAddress';
import { api } from '@/lib/api';
import { EthereumIcon, GoogleIcon } from '@/components/icons/SignInIcons';
import { EmailMethodRow } from './EmailMethodRow';
import { SignInMethodsSkeleton } from './SignInMethodsSkeleton';
import s from './SignInMethods.module.scss';

/**
 * One list for both clients. The only thing the desktop app cannot do here is
 * start Google's OAuth redirect — Google refuses to run in an embedded webview
 * — so that single Connect is disabled there; email and WalletConnect run in
 * place on both.
 */
export function SignInMethodsList() {
  const isDesktop = useDesktopApp();
  const { data: identities, isLoading: identitiesLoading } = useIdentities();
  const { data: passkeys, isLoading: passkeysLoading } = usePasskeys();
  const { mutate: unlink, isPending: isUnlinking } = useUnlinkIdentity();
  const { sign, step: siweStep } = useSiweSign();

  const { data: emailMethod, isLoading: emailLoading } = useEmailMethod();
  const isLoading = identitiesLoading || passkeysLoading || emailLoading;
  const passkeyCount = passkeys?.length ?? 0;

  // The address counts as a sign-in method, so the last identity is only
  // un-unlinkable when there is no address to fall back to.
  const isOnlyOne = (identities?.length ?? 0) + passkeyCount <= 1 && !emailMethod?.email;

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
    // A full document navigation is required because this route starts an external OAuth redirect.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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

  const providers = [
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
          <SignInMethodsSkeleton rows={4} />
        ) : (
          providers.map((provider, index) => {
            const identity = identities?.find((item) => item.provider === provider.id);
            const isLinked = !!identity;
            return (
              <React.Fragment key={provider.id}>
                {index > 0 && <div className={s.divider} />}
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
                  ) : provider.id === 'google' && isDesktop ? (
                    <TooltipOrPopover
                      trigger={
                        <span tabIndex={0} className={s.tooltipWrapper}>
                          <Button variant="outline" size="sm" disabled data-testid="connect-google">
                            Connect
                          </Button>
                        </span>
                      }
                      side="left"
                    >
                      Google can only be linked from SigNote in your browser
                    </TooltipOrPopover>
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
          })
        )}
        {!isLoading && (
          <>
            <div className={s.divider} />
            <div className={s.identityRow} data-testid="identity-passkey">
              <div className={s.identityIcon}>
                <Fingerprint size={17} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className={s.identityInfo}>
                <span className={s.identityLabel}>Passkeys</span>
                {passkeyCount > 0 && (
                  <span className={s.identitySubject}>
                    {passkeyCount} {passkeyCount === 1 ? 'passkey' : 'passkeys'}
                  </span>
                )}
              </div>
              <Button variant="outline" size="sm" asChild data-testid="manage-passkeys-btn">
                <Link href="/passkeys">{passkeyCount === 0 ? 'Set up' : 'Manage'}</Link>
              </Button>
            </div>
            <div className={s.divider} />
            {/* Prefilled with the address Google reported when it never verified
                it — that account has no email, and this is how it gets one. */}
            <EmailMethodRow googleEmail={identities?.find((item) => item.provider === 'google')?.email} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
