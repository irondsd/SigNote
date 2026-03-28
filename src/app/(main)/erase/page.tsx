'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { EraseFlow } from '@/components/erase/EraseFlow';
import { useProfile } from '@/hooks/useProfile';
import s from '@/components/erase/EraseFlow.module.scss';

const STEPS = [
  { key: 'seals', label: 'Seals', endpoint: '/api/erase/seals', requiresEncryptionProfile: true },
  { key: 'secrets', label: 'Secrets', endpoint: '/api/erase/secrets', requiresEncryptionProfile: true },
  { key: 'notes', label: 'Notes', endpoint: '/api/erase/notes', requiresEncryptionProfile: false },
  { key: 'encryption', label: 'Encryption Profile', endpoint: '/api/erase/encryption', requiresEncryptionProfile: true },
  { key: 'account', label: 'User Account', endpoint: '/api/erase/account', requiresEncryptionProfile: false },
];

const EXPLANATION = (
  <p className={s.explanationText}>
    This will permanently delete <strong>all data</strong> associated with your account — notes,
    secrets, seals, your encryption profile, and your account itself.{' '}
    <strong>This cannot be undone.</strong>
  </p>
);

export default function ErasePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile } = useProfile();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  const address = session.user.address;
  const statement = `By signing this message I agree to erase all data associated with account ${address}`;

  return (
    <EraseFlow
      title="Erase Account"
      explanation={EXPLANATION}
      statement={statement}
      verifyEndpoint="/api/erase/verify"
      steps={STEPS}
      hasEncryptionProfile={profile?.hasEncryptionProfile}
      doneTitle="Account permanently erased"
      doneDesc="All your data has been deleted. You will be signed out automatically."
      onDone={() => void signOut({ callbackUrl: '/' })}
    />
  );
}
