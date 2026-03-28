'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { UserRejectedRequestError } from 'viem';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Minus,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProfile } from '@/hooks/useProfile';
import s from './page.module.scss';

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

type EraseStep = {
  key: string;
  label: string;
  endpoint: string;
  status: StepStatus;
  requiresEncryptionProfile: boolean;
};

const initialSteps = (): EraseStep[] => [
  { key: 'seals', label: 'Seals', endpoint: '/api/erase/seals', status: 'pending', requiresEncryptionProfile: true },
  { key: 'secrets', label: 'Secrets', endpoint: '/api/erase/secrets', status: 'pending', requiresEncryptionProfile: true },
  { key: 'notes', label: 'Notes', endpoint: '/api/erase/notes', status: 'pending', requiresEncryptionProfile: false },
  { key: 'encryption', label: 'Encryption Profile', endpoint: '/api/erase/encryption', status: 'pending', requiresEncryptionProfile: true },
  { key: 'account', label: 'User Account', endpoint: '/api/erase/account', status: 'pending', requiresEncryptionProfile: false },
];

type Phase = 'warning' | 'signing' | 'ready' | 'erasing' | 'done';

function StepRow({ step }: { step: EraseStep }) {
  return (
    <div className={s.stepRow}>
      <div className={s.stepIcon}>
        {step.status === 'done' && <CheckCircle2 size={18} className={s.iconDone} />}
        {step.status === 'running' && <Loader2 size={18} className={s.iconRunning} />}
        {step.status === 'error' && <XCircle size={18} className={s.iconError} />}
        {step.status === 'pending' && <Circle size={18} className={s.iconPending} />}
        {step.status === 'skipped' && <Minus size={18} className={s.iconSkipped} />}
      </div>
      <span className={s.stepLabel} data-status={step.status}>
        {step.label}
      </span>
      {step.status === 'skipped' && <span className={s.stepSkippedNote}>not set up</span>}
    </div>
  );
}

export default function ErasePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile } = useProfile();
  const { address: walletAddress, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>('warning');
  const [eraseToken, setEraseToken] = useState<string | null>(null);
  const [steps, setSteps] = useState<EraseStep[]>(initialSteps());
  const [signingError, setSigningError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(() => {
      void signOut({ callbackUrl: '/' });
    }, 3000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (status !== 'authenticated') return null;

  const address = session.user.address;

  const statement = `By signing this message I agree to erase all data associated with account ${address}`;

  const handleSign = async () => {
    if (!walletAddress) {
      setSigningError('Wallet not connected. Please reconnect your wallet and try again.');
      return;
    }

    setSigningError(null);
    setPhase('signing');

    try {
      const { nonce } = await api.get('/api/auth/nonce').json<{ nonce: string }>();

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement,
        uri: window.location.origin,
        version: '1',
        chainId: chain?.id ?? 1,
        nonce,
      });

      const messageStr = message.prepareMessage();
      const signature = await signMessageAsync({ message: messageStr });

      const { token } = await api
        .post('/api/erase/verify', { json: { message: messageStr, signature } })
        .json<{ token: string }>();

      setEraseToken(token);

      // Pre-mark steps that should be skipped if no encryption profile
      if (!profile?.hasEncryptionProfile) {
        setSteps((prev) =>
          prev.map((step) =>
            step.requiresEncryptionProfile ? { ...step, status: 'skipped' } : step,
          ),
        );
      }

      setPhase('ready');
    } catch (err) {
      if (err instanceof UserRejectedRequestError) {
        setSigningError('Signature rejected. Please try again.');
        setPhase('warning');
        return;
      }
      console.error('Erase sign error:', err);
      setSigningError('Signature verification failed. Please try again.');
      setPhase('warning');
    }
  };

  const runStep = async (step: EraseStep, token: string): Promise<boolean> => {
    if (step.status === 'skipped') return true;

    setSteps((prev) => prev.map((s) => (s.key === step.key ? { ...s, status: 'running' } : s)));

    try {
      await api.delete(step.endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSteps((prev) => prev.map((s) => (s.key === step.key ? { ...s, status: 'done' } : s)));
      return true;
    } catch (err) {
      console.error(`Erase step ${step.key} failed:`, err);
      setSteps((prev) => prev.map((s) => (s.key === step.key ? { ...s, status: 'error' } : s)));
      return false;
    }
  };

  const handleStartErasure = async () => {
    if (!eraseToken) return;
    setPhase('erasing');

    const currentSteps = steps;
    for (const step of currentSteps) {
      if (step.status === 'skipped') continue;
      const ok = await runStep(step, eraseToken);
      if (!ok) {
        setPhase('ready');
        toast.error(`Failed to erase ${step.label}. You can retry.`);
        return;
      }
    }

    setPhase('done');
  };

  const handleRetry = async () => {
    if (!eraseToken) return;
    const currentSteps = steps;
    setPhase('erasing');

    for (const step of currentSteps) {
      if (step.status === 'done' || step.status === 'skipped') continue;
      const ok = await runStep(step, eraseToken);
      if (!ok) {
        setPhase('ready');
        toast.error(`Failed to erase ${step.label}. You can retry.`);
        return;
      }
    }

    setPhase('done');
  };

  const hasError = steps.some((s) => s.status === 'error');
  const isErasing = phase === 'erasing';

  return (
    <div className={s.container}>
      <div className={s.content}>
        <Card className={s.dangerCard}>
          <CardHeader>
            <CardTitle className={s.dangerTitle}>
              <AlertTriangle size={18} />
              Erase Account
            </CardTitle>
          </CardHeader>
          <CardContent className={s.body}>
            {phase === 'done' ? (
              <div className={s.doneSection}>
                <CheckCircle2 size={40} className={s.doneIcon} />
                <p className={s.doneTitle}>Account permanently erased</p>
                <p className={s.doneDesc}>
                  All your data has been deleted. You will be signed out automatically.
                </p>
              </div>
            ) : (
              <>
                {/* Explanation */}
                <div className={s.explanation}>
                  <p className={s.explanationText}>
                    This will permanently delete <strong>all data</strong> associated with your
                    account — notes, secrets, seals, your encryption profile, and your account
                    itself. <strong>This cannot be undone.</strong>
                  </p>
                </div>

                <div className={s.divider} />

                {/* Signature section */}
                {(phase === 'warning' || phase === 'signing') && (
                  <div className={s.signSection}>
                    <p className={s.signLabel}>
                      Sign the following message with your wallet to prove intent:
                    </p>
                    <pre className={s.messagePreview}>{statement}</pre>
                    {signingError && <p className={s.errorText}>{signingError}</p>}
                    <Button
                      variant="destructive"
                      onClick={handleSign}
                      disabled={phase === 'signing'}
                      className={s.signButton}
                    >
                      {phase === 'signing' ? (
                        <>
                          <Loader2 size={14} className={s.spinnerIcon} />
                          Waiting for signature…
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={14} />
                          Sign to prove intent
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Verified + steps */}
                {(phase === 'ready' || phase === 'erasing') && (
                  <div className={s.eraseSection}>
                    <div className={s.verifiedBadge}>
                      <ShieldCheck size={14} />
                      Signature verified
                    </div>

                    <div className={s.stepList}>
                      {steps.map((step) => (
                        <StepRow key={step.key} step={step} />
                      ))}
                    </div>

                    {hasError ? (
                      <Button
                        variant="destructive"
                        onClick={handleRetry}
                        disabled={isErasing}
                        className={s.eraseButton}
                      >
                        <Trash2 size={14} />
                        Retry failed steps
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        onClick={handleStartErasure}
                        disabled={isErasing}
                        className={s.eraseButton}
                      >
                        {isErasing ? (
                          <>
                            <Loader2 size={14} className={s.spinnerIcon} />
                            Erasing…
                          </>
                        ) : (
                          <>
                            <Trash2 size={14} />
                            Start Erasure
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
