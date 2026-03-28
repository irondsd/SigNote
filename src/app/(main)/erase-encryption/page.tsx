'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { EraseFlow } from '@/components/erase/EraseFlow';
import s from '@/components/erase/EraseFlow.module.scss';

const STEPS = [
  { key: 'seals', label: 'Seals', endpoint: '/api/erase/seals' },
  { key: 'secrets', label: 'Secrets', endpoint: '/api/erase/secrets' },
  { key: 'encryption', label: 'Encryption Profile', endpoint: '/api/erase/encryption' },
];

const EXPLANATION = (
  <p className={s.explanationText}>
    Your secrets and seals are encrypted using a key derived from your passphrase. Without the correct passphrase, they{' '}
    <strong>cannot be decrypted</strong> — not by you, not by us. If you have forgotten your passphrase, erasing the
    encryption profile lets you start fresh. <strong>Your regular notes will not be affected.</strong> This cannot be
    undone.
  </p>
);

export default function EraseEncryptionPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  const address = session.user.address;
  const statement = `By signing this message I agree to erase my encryption profile and all secrets and seals associated with account ${address}`;

  return (
    <EraseFlow
      title="Erase Encryption Profile"
      explanation={EXPLANATION}
      statement={statement}
      verifyEndpoint="/api/erase-encryption/verify"
      steps={STEPS}
      doneTitle="Encryption profile erased"
      doneDesc="Your encrypted data has been removed. You can set up a new encryption profile from your profile page."
      onDone={() => {
        void qc.invalidateQueries({ queryKey: ['profile'] });
        void qc.invalidateQueries({ queryKey: ['secrets'] });
        void qc.invalidateQueries({ queryKey: ['seals'] });
        router.push('/profile');
      }}
    />
  );
}
