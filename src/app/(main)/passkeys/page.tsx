'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Fingerprint, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useDesktopApp } from '@/hooks/useDesktopApp';
import { useEmailMethod } from '@/hooks/useEmailAuth';
import { useIdentities } from '@/hooks/useIdentities';
import {
  useAddPasskey,
  usePasskeys,
  usePasskeySupport,
  useRemovePasskey,
  useRenamePasskey,
  type Passkey,
} from '@/hooks/usePasskeys';
import { getRelativeTime } from '@/utils/getRelativeTime';
import s from './page.module.scss';

function exactDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function PasskeyCard({
  passkey,
  index,
  canRemove,
  removing,
  onRename,
  onRemove,
}: {
  passkey: Passkey;
  index: number;
  canRemove: boolean;
  removing: boolean;
  onRename: (nickname: string) => void;
  onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nickname, setNickname] = useState(passkey.nickname);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = () => {
    setNickname(passkey.nickname);
    setRenaming(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitRename = () => {
    const next = nickname.trim();
    if (next && next !== passkey.nickname) onRename(next);
    else setNickname(passkey.nickname);
    setRenaming(false);
  };

  return (
    <div
      className={s.passkeyCard}
      data-testid="passkey-row"
      style={{ '--animation-index': index } as React.CSSProperties}
    >
      <div className={s.iconCol}>
        <Fingerprint size={25} strokeWidth={1.5} aria-hidden="true" />
      </div>

      <div className={s.passkeyInfo}>
        <div className={s.titleRow}>
          {renaming ? (
            <input
              ref={inputRef}
              className={s.renameInput}
              value={nickname}
              maxLength={50}
              autoFocus
              aria-label="Passkey name"
              onChange={(event) => setNickname(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === 'Escape') {
                  setNickname(passkey.nickname);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <h2 className={s.passkeyName} title={passkey.nickname}>
              {passkey.nickname}
            </h2>
          )}
          {passkey.backedUp && (
            <Badge variant="secondary" className={s.syncedBadge}>
              Synced
            </Badge>
          )}
        </div>
        <div className={s.meta}>
          <span title={exactDate(passkey.createdAt)}>Added {getRelativeTime(passkey.createdAt)}</span>
          <span className={s.dot}>·</span>
          <span title={passkey.lastUsedAt ? exactDate(passkey.lastUsedAt) : undefined}>
            {passkey.lastUsedAt ? `Last used ${getRelativeTime(passkey.lastUsedAt)}` : 'Not used yet'}
          </span>
        </div>
      </div>

      <div className={s.actions}>
        <Button variant="ghost" size="icon-sm" onClick={startRename} aria-label={`Rename ${passkey.nickname}`}>
          <Pencil size={14} aria-hidden="true" />
        </Button>
        {canRemove ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={s.removeButton}
                disabled={removing}
                aria-label={`Remove ${passkey.nickname}`}
              >
                {removing ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 size={14} aria-hidden="true" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {passkey.nickname}?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will no longer be able to sign in with this passkey. The copy stored by your device or password
                  manager may need to be removed there separately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onRemove}>
                  Remove passkey
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <TooltipOrPopover
            trigger={
              <span tabIndex={0} className={s.tooltipWrapper}>
                <Button variant="ghost" size="icon-sm" disabled aria-label={`Remove ${passkey.nickname}`}>
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </span>
            }
            side="left"
          >
            You must keep at least one sign-in method
          </TooltipOrPopover>
        )}
      </div>
    </div>
  );
}

export default function PasskeysPage() {
  const { status } = useSession();
  const router = useRouter();
  const isDesktop = useDesktopApp();
  const supportsPasskeys = usePasskeySupport();
  const { data: passkeys, isLoading: passkeysLoading } = usePasskeys();
  const { data: identities, isLoading: identitiesLoading } = useIdentities();
  const { data: emailMethod, isLoading: emailLoading } = useEmailMethod();
  const add = useAddPasskey();
  const rename = useRenamePasskey();
  const remove = useRemovePasskey();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [router, status]);

  if (status !== 'authenticated') return null;

  const isLoading = passkeysLoading || identitiesLoading || emailLoading;
  const methodCount = (passkeys?.length ?? 0) + (identities?.length ?? 0) + (emailMethod?.email ? 1 : 0);
  const canRemove = methodCount > 1;

  const handleAdd = () => {
    add.mutate(undefined, {
      onSuccess: () => toast.success('Passkey added.'),
      onError: (error) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') return;
        toast.error('Could not add the passkey. Please try again.');
      },
    });
  };

  return (
    <div className={s.container}>
      <div className={s.content}>
        <Card>
          <CardHeader className={s.header}>
            <h1 className={s.cardTitle}>Passkeys</h1>
            {isDesktop ? (
              <TooltipOrPopover
                trigger={
                  <span tabIndex={0} className={s.tooltipWrapper}>
                    <Button size="sm" disabled data-testid="add-passkey-btn">
                      <Plus size={14} aria-hidden="true" />
                      Add passkey
                    </Button>
                  </span>
                }
                side="left"
              >
                Add passkeys from SigNote in your browser
              </TooltipOrPopover>
            ) : supportsPasskeys ? (
              <Button size="sm" onClick={handleAdd} disabled={add.isPending} data-testid="add-passkey-btn">
                {add.isPending ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Plus size={14} aria-hidden="true" />
                )}
                {add.isPending ? 'Adding…' : 'Add passkey'}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className={s.body}>
            <p className={s.intro}>
              Sign in with your fingerprint, face, screen lock, or security key. Passkeys only unlock your account; your
              encrypted notes still use your passphrase.
            </p>

            {isLoading && (
              <div className={s.loadingRow}>
                <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              </div>
            )}

            {!isLoading && passkeys && passkeys.length > 0 && (
              <div className={s.list}>
                {passkeys.map((passkey, index) => (
                  <PasskeyCard
                    key={passkey.id}
                    passkey={passkey}
                    index={index}
                    canRemove={canRemove}
                    removing={remove.isPending && remove.variables === passkey.id}
                    onRename={(nickname) =>
                      rename.mutate(
                        { id: passkey.id, nickname },
                        {
                          onSuccess: () => toast.success('Passkey renamed.'),
                          onError: () => toast.error('Could not rename the passkey.'),
                        },
                      )
                    }
                    onRemove={() =>
                      remove.mutate(passkey.id, {
                        onSuccess: () => toast.success('Passkey removed.'),
                        onError: (error) =>
                          toast.error(
                            error instanceof Error && error.message.includes('LAST_IDENTITY')
                              ? 'You must keep at least one sign-in method.'
                              : 'Could not remove the passkey.',
                          ),
                      })
                    }
                  />
                ))}
              </div>
            )}

            {!isLoading && passkeys?.length === 0 && (
              <div className={s.empty}>
                <span className={s.emptyIcon}>
                  <Fingerprint size={28} strokeWidth={1.4} aria-hidden="true" />
                </span>
                <div>
                  <h2>No passkeys yet</h2>
                  <p>Add one to sign in without a password or emailed code.</p>
                </div>
              </div>
            )}

            {!isDesktop && !supportsPasskeys && !isLoading && (
              <p className={s.unsupported}>This browser does not support passkeys.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
