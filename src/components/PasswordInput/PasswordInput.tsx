'use client';

import { forwardRef, useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/utils/cn';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  wrapperClassName?: string;
  toggleClassName?: string;
  visibilityLabel?: string;
  toggleTabIndex?: number;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, wrapperClassName, toggleClassName, visibilityLabel = 'passphrase', toggleTabIndex, disabled, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={cn('relative flex items-center', wrapperClassName)}>
      <Input
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={cn('pr-10', className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('text-muted-foreground absolute inset-y-0 right-0 hover:bg-transparent', toggleClassName)}
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        tabIndex={toggleTabIndex}
        aria-label={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`}
        aria-pressed={visible}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
});
