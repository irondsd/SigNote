'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import { SignInModal } from '@/components/SignInModal/SignInModal';
import { LogIn } from 'lucide-react';

type SignInButtonProps = {
  className?: string;
  size?: 'default' | 'large';
};

export function SignInButton({ className, size = 'default' }: SignInButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (size === 'large') {
    return (
      <>
        <Button
          data-testid="sign-in-button"
          size="lg"
          className={cn(
            'w-full rounded-[14px] text-base font-bold h-13 py-2 px-8 shadow-[0_4px_20px_color-mix(in_oklch,var(--primary)_20%,transparent)] hover:-translate-y-px',
            className,
          )}
          onClick={() => setShowModal(true)}
        >
          <LogIn size={16} />
          Sign in
        </Button>
        {showModal && <SignInModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  return (
    <>
      <Button
        data-testid="sign-in-button"
        variant="outline"
        className={cn('w-full bg-muted hover:bg-primary hover:text-primary-foreground hover:border-primary', className)}
        onClick={() => setShowModal(true)}
      >
        Sign in
      </Button>
      {showModal && <SignInModal onClose={() => setShowModal(false)} />}
    </>
  );
}
