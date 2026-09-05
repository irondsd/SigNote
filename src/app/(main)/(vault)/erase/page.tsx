'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { clearDraft } from '@/lib/draft';
import { EraseFlow, type StepConfig } from '@/components/erase/EraseFlow';
import { useProfile } from '@/hooks/useProfile';
import s from '@/components/erase/EraseFlow.module.scss';

const STEPS: StepConfig[] = [
  { key: 'seals', label: 'Seals', requiresEncryptionProfile: true },
  { key: 'secrets', label: 'Secrets', requiresEncryptionProfile: true },
  { key: 'notes', label: 'Notes', requiresEncryptionProfile: false },
  { key: 'otp', label: 'Authenticator', requiresEncryptionProfile: true },
  { key: 'encryption', label: 'Encryption Profile', requiresEncryptionProfile: true },
  { key: 'account', label: 'User Account', requiresEncryptionProfile: false },
];

const EXPLANATION = (
  <p className={s.explanationText}>
    This will permanently delete <strong>all data</strong> associated with your account — notes, secrets, seals,
    Authenticator credentials, your encryption profile, and the account itself. A trusted device that stays offline may
    continue generating Authenticator codes until it reconnects and removes its obsolete local cache.{' '}
    <strong>This cannot be undone.</strong>
  </p>
);

export default function ErasePage() {
  const { status } = useSession();
  const router = useRouter();
  const { data: profile } = useProfile();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  return (
    <EraseFlow
      title="Erase Account"
      explanation={EXPLANATION}
      scope="all"
      steps={STEPS}
      hasEncryptionProfile={profile?.hasEncryptionProfile}
      doneTitle="Account permanently erased"
      doneDesc="All your data has been deleted. You will be signed out automatically."
      onDone={() => {
        clearDraft();
        void signOut({ callbackUrl: '/' });
      }}
    />
  );
}
