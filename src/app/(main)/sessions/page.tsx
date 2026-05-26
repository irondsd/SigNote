'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2, LogOut } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { SessionCard } from '@/components/SessionCard/SessionCard';
import { useSessions } from '@/hooks/useSessions';
import { useRevokeAllOtherSessions, useRevokeSession } from '@/hooks/useSessionMutations';
import s from './page.module.scss';

export default function SessionsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { data: sessions, isLoading } = useSessions();
  const { mutate: revokeSession, isPending: isRevokingOne, variables: revokingId } = useRevokeSession();
  const { mutate: revokeOthers, isPending: isRevokingOthers } = useRevokeAllOtherSessions();
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  const otherSessionCount = sessions?.filter((sess) => !sess.current).length ?? 0;

  return (
    <div className={s.container}>
      <div className={s.content}>
        <Card>
          <CardHeader className={s.header}>
            <CardTitle>Active sessions</CardTitle>
            {otherSessionCount > 0 && (
              <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isRevokingOthers}>
                    {isRevokingOthers ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                    Sign out everywhere else
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out of {otherSessionCount} other session{otherSessionCount === 1 ? '' : 's'}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every other device signed in to your account will be signed out on their next request. This one stays.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        revokeOthers();
                        setConfirmAllOpen(false);
                      }}
                    >
                      Sign out everywhere else
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardHeader>
          <CardContent className={s.body}>
            <p className={s.intro}>
              Devices currently signed in to your account. Revoke any session you don&apos;t recognize.
            </p>

            {isLoading && (
              <div className={s.loadingRow}>
                <Loader2 size={20} className="animate-spin" />
              </div>
            )}

            {!isLoading && sessions && sessions.length > 0 && (
              <div className={s.list}>
                {sessions.map((sess, index) => (
                  <div key={sess._id} style={{ '--animation-index': index } as React.CSSProperties}>
                    <SessionCard
                      session={sess}
                      onRevoke={(id) => revokeSession(id)}
                      isRevoking={isRevokingOne && revokingId === sess._id}
                    />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && sessions && sessions.length === 0 && (
              <p className={s.empty}>
                No active sessions yet. If you stay signed in for a while, this is where they&apos;ll show up.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
