'use client';

import { useState } from 'react';
import { Monitor, Smartphone, Tablet, HelpCircle, LogOut, KeyRound, Wallet, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { RelativeDate } from '@/components/RelativeDate/RelativeDate';
import type { SessionRow } from '@/hooks/useSessions';
import s from './SessionCard.module.scss';

type SessionCardProps = {
  session: SessionRow;
  onRevoke: (id: string) => void;
  isRevoking: boolean;
};

const renderDeviceIcon = (deviceType: SessionRow['deviceType'], className: string) => {
  switch (deviceType) {
    case 'mobile':
      return <Smartphone size={28} strokeWidth={1.4} className={className} />;
    case 'tablet':
      return <Tablet size={28} strokeWidth={1.4} className={className} />;
    case 'desktop':
      return <Monitor size={28} strokeWidth={1.4} className={className} />;
    default:
      return <HelpCircle size={28} strokeWidth={1.4} className={className} />;
  }
};

const renderProviderIcon = (provider: SessionRow['provider']) =>
  provider === 'siwe' ? <Wallet size={12} strokeWidth={1.6} /> : <KeyRound size={12} strokeWidth={1.6} />;

const providerLabelFor = (provider: SessionRow['provider']) =>
  provider === 'siwe' ? 'Ethereum wallet' : 'Google';

export function SessionCard({ session, onRevoke, isRevoking }: SessionCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className={s.card} data-current={session.current || undefined}>
      <div className={s.iconCol}>{renderDeviceIcon(session.deviceType, s.deviceIcon)}</div>

      <div className={s.body}>
        <div className={s.headRow}>
          <h3 className={s.title}>
            {session.browser} <span className={s.muted}>on</span> {session.os}
          </h3>
          {session.current && (
            <Badge variant="secondary" className={s.currentBadge}>
              Current
            </Badge>
          )}
        </div>

        <div className={s.metaRow}>
          <span className={s.metaItem}>
            {renderProviderIcon(session.provider)}
            {providerLabelFor(session.provider)}
          </span>
          {session.ip && (
            <>
              <span className={s.dot}>·</span>
              <span className={s.metaItem} title={session.ip}>
                {session.ip}
              </span>
            </>
          )}
          <span className={s.dot}>·</span>
          <RelativeDate updatedAt={session.updatedAt} createdAt={session.createdAt} className={s.metaItem} />
        </div>
      </div>

      <div className={s.actionCol}>
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant={session.current ? 'outline' : 'destructive'}
              size="sm"
              disabled={isRevoking}
              data-testid={`revoke-session-${session._id}`}
            >
              {isRevoking ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              {session.current ? 'Sign out' : 'Revoke'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {session.current ? 'Sign out of this device?' : 'Revoke this session?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {session.current
                  ? 'You will be returned to the home page and need to sign in again.'
                  : `This will immediately end the session on ${session.browser} (${session.os}). Anyone using that device will be signed out on the next request.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onRevoke(session._id);
                  setDialogOpen(false);
                }}
              >
                {session.current ? 'Sign out' : 'Revoke'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
