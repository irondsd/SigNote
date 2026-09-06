'use client';

import { SquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyStateLayout } from '@/components/EmptyState/EmptyStateLayout';
import s from './AuthPage.module.scss';

export function AuthEmptyState({ onNew, disabled }: { onNew: () => void; disabled?: boolean }) {
  return (
    <EmptyStateLayout
      icon={<span className={s.emptyDial} aria-hidden="true" />}
      heading="No authenticators yet"
      sub="Setup keys are encrypted with your key, like secrets. Codes are generated on this device."
      action={
        <Button className="mt-2" onClick={onNew} disabled={disabled} data-testid="auth-empty-new">
          <SquarePlus size={16} />
          Add new auth
        </Button>
      }
    />
  );
}
