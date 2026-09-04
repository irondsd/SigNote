'use client';

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { EmailCodeForm } from '@/components/EmailCodeForm/EmailCodeForm';
import { errorCode, useDetachEmail, useEmailMethod, useRequestLinkCode, useVerifyLink } from '@/hooks/useEmailAuth';
import s from './SignInMethods.module.scss';

const describeLinkError = (err: unknown, step: 'request' | 'verify') => {
  const code = errorCode(err);
  if (code.includes('TAKEN')) return 'That address already signs into a different SigNote account.';
  if (code.includes('HAS_EMAIL')) return 'This account already has an email address.';
  if (code.includes('Too many')) return code;
  return step === 'request'
    ? 'Could not send a code. Check the address and try again.'
    : 'That code is not valid. Request a new one.';
};

/**
 * The Email row of the sign-in methods list. Three states, and which one shows
 * is a straight read of `removable`:
 *
 * - no address        → Link
 * - proved by a code  → address + Remove
 * - proved by Google  → address, read-only, "via Google" (unlink Google first)
 */
export function EmailMethodRow({ googleEmail }: { googleEmail?: string }) {
  const { data: method } = useEmailMethod();
  const { mutateAsync: requestCode } = useRequestLinkCode();
  const { mutateAsync: verify } = useVerifyLink();
  const { mutate: detach, isPending: isDetaching } = useDetachEmail();
  const [linking, setLinking] = useState(false);

  const email = method?.email ?? null;
  const removable = method?.removable ?? false;

  const handleDetach = () => {
    detach(undefined, {
      onSuccess: () => toast.success('Email address removed.'),
      onError: (err) => {
        const code = errorCode(err);
        if (code.includes('LAST_CREDENTIAL')) toast.error('You must keep at least one sign-in method.');
        else if (code.includes('OWNED_BY_IDENTITY')) toast.error('Unlink Google first — it vouches for this address.');
        else toast.error('Could not remove the address.');
      },
    });
  };

  return (
    <>
      <div className={s.identityRow} data-testid="identity-email">
        <div className={s.identityIcon}>
          <Mail size={16} strokeWidth={1.8} />
        </div>
        <div className={s.identityInfo}>
          <span className={s.identityLabel}>Email</span>
          {email && (
            <span className={s.identitySubject} data-testid="email-method-address">
              {email}
              {!removable && ' · via Google'}
            </span>
          )}
        </div>

        {!email ? (
          <Button variant="outline" size="sm" onClick={() => setLinking(true)} data-testid="connect-email">
            Connect
          </Button>
        ) : removable ? (
          <Button variant="outline" size="sm" disabled={isDetaching} onClick={handleDetach} data-testid="unlink-email">
            {isDetaching ? <Loader2 size={14} className="animate-spin" /> : null}
            Remove
          </Button>
        ) : (
          <TooltipOrPopover
            trigger={
              <span tabIndex={0} className={s.tooltipWrapper}>
                <Button variant="outline" size="sm" disabled data-testid="unlink-email">
                  Remove
                </Button>
              </span>
            }
            side="left"
          >
            Google vouches for this address. Unlink Google to remove it.
          </TooltipOrPopover>
        )}
      </div>

      {linking && (
        <Backdrop onClose={() => setLinking(false)}>
          <Modal className={s.linkModal}>
            <h2 className={s.linkHeading}>Add an email address</h2>
            <p className={s.linkIntro}>
              We&apos;ll send a code to confirm it&apos;s yours. Afterwards you can sign in with a code instead of a
              wallet.
            </p>
            <EmailCodeForm
              testIdPrefix="link-email"
              submitLabel="Confirm"
              initialEmail={googleEmail}
              describeError={describeLinkError}
              onRequestCode={(address) => requestCode(address)}
              onSubmitCode={async (address, code) => {
                await verify({ email: address, code });
                toast.success('Email address added.');
                setLinking(false);
              }}
            />
          </Modal>
        </Backdrop>
      )}
    </>
  );
}
