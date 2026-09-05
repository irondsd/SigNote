'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { EraseFlow, type StepConfig } from '@/components/erase/EraseFlow';
import s from '@/components/erase/EraseFlow.module.scss';

const STEPS: StepConfig[] = [
  { key: 'seals', label: 'Seals' },
  { key: 'secrets', label: 'Secrets' },
  { key: 'otp', label: 'Authenticator' },
  { key: 'encryption', label: 'Encryption Profile' },
];

const EXPLANATION = (
  <p className={s.explanationText}>
    Your secrets, seals, and Authenticator credentials are encrypted using keys derived from your passphrase. Erasing
    the encryption profile permanently deletes all of them and lets you start fresh.{' '}
    <strong>Your regular notes will not be affected.</strong> A trusted device that stays offline may continue
    generating Authenticator codes until it reconnects and removes its obsolete local cache. This cannot be undone.
  </p>
);

export default function EraseEncryptionPage() {
  const { status } = useSession();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  return (
    <EraseFlow
      title="Erase Encryption Profile"
      explanation={EXPLANATION}
      scope="encryption"
      steps={STEPS}
      doneTitle="Encryption profile erased"
      doneDesc="Your encrypted data and synced Authenticator credentials have been removed. You can set up a new encryption profile from your profile page."
      onDone={() => {
        void qc.invalidateQueries({ queryKey: ['profile'] });
        void qc.invalidateQueries({ queryKey: ['secrets'] });
        void qc.invalidateQueries({ queryKey: ['seals'] });
        router.push('/profile');
      }}
    />
  );
}
