import { CheckCircle2, Circle, Loader2, Minus, XCircle } from 'lucide-react';
import type { EraseStep } from './types';
import s from './EraseFlow.module.scss';

export function StepRow({ step }: { step: EraseStep }) {
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
