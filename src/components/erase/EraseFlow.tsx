'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { StepRow } from './StepRow';
import type { EraseStep, Phase } from './types';
import s from './EraseFlow.module.scss';

type StepConfig = Pick<EraseStep, 'key' | 'label' | 'endpoint'> & {
  requiresEncryptionProfile?: boolean;
};

type EraseFlowProps = {
  title: string;
  explanation: React.ReactNode;
  verifyEndpoint: string;
  steps: StepConfig[];
  hasEncryptionProfile?: boolean;
  doneTitle: string;
  doneDesc: string;
  onDone: () => void;
};

function initSteps(configs: StepConfig[]): EraseStep[] {
  return configs.map(({ key, label, endpoint }) => ({ key, label, endpoint, status: 'pending' }));
}

export function EraseFlow({
  title,
  explanation,
  verifyEndpoint,
  steps: stepConfigs,
  hasEncryptionProfile = true,
  doneTitle,
  doneDesc,
  onDone,
}: EraseFlowProps) {
  const [phase, setPhase] = useState<Phase>('warning');
  const [eraseToken, setEraseToken] = useState<string | null>(null);
  const [steps, setSteps] = useState<EraseStep[]>(() => initSteps(stepConfigs));
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(onDone, 10000);
    return () => clearTimeout(timer);
  }, [phase, onDone]);

  useEffect(() => {
    if (phase !== 'ready') return;
    if (hasEncryptionProfile !== false) return;
    const skipKeys = new Set(stepConfigs.filter((c) => c.requiresEncryptionProfile).map((c) => c.key));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSteps((prev) => prev.map((step) => (skipKeys.has(step.key) ? { ...step, status: 'skipped' } : step)));
  }, [phase, hasEncryptionProfile, stepConfigs]);

  const handleConfirm = async () => {
    setConfirmError(null);
    setPhase('confirming');

    try {
      const { token } = await api.post(verifyEndpoint).json<{ token: string }>();

      setEraseToken(token);
      setPhase('ready');
    } catch (err) {
      console.error('Erase confirm error:', err);
      setConfirmError('Failed to confirm. Please try again.');
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

  const runAllPending = async (token: string) => {
    const currentSteps = steps;
    for (const step of currentSteps) {
      if (step.status === 'done' || step.status === 'skipped') continue;
      const ok = await runStep(step, token);
      if (!ok) {
        setPhase('ready');
        toast.error(`Failed to erase ${step.label}. You can retry.`);
        return;
      }
    }
    setPhase('done');
  };

  const handleStartErasure = async () => {
    if (!eraseToken) return;
    setPhase('erasing');
    await runAllPending(eraseToken);
  };

  const handleRetry = async () => {
    if (!eraseToken) return;
    setPhase('erasing');
    await runAllPending(eraseToken);
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
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className={s.body}>
            {phase === 'done' ? (
              <div className={s.doneSection}>
                <CheckCircle2 size={40} className={s.doneIcon} />
                <p className={s.doneTitle}>{doneTitle}</p>
                <p className={s.doneDesc}>{doneDesc}</p>
              </div>
            ) : (
              <>
                <div className={s.explanation}>{explanation}</div>

                <div className={s.divider} />

                {(phase === 'warning' || phase === 'confirming') && (
                  <div className={s.signSection}>
                    {confirmError && <p className={s.errorText}>{confirmError}</p>}
                    <Button
                      variant="destructive"
                      onClick={handleConfirm}
                      disabled={phase === 'confirming'}
                      className={s.signButton}
                    >
                      {phase === 'confirming' ? (
                        <>
                          <Loader2 size={14} className={s.spinnerIcon} />
                          Confirming…
                        </>
                      ) : (
                        <>
                          <Trash2 size={14} />I confirm, delete my data
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {(phase === 'ready' || phase === 'erasing') && (
                  <div className={s.eraseSection}>
                    <div className={s.verifiedBadge}>
                      <CheckCircle2 size={14} />
                      Confirmed
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
