import type { ComponentProps, ReactNode } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import s from './SignInMethodButton.module.scss';

type SignInMethodButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  icon: ReactNode;
  children: ReactNode;
  /** Swaps the chevron for a "Last used" pill. */
  isLastUsed?: boolean;
  /** Replaces the icon with a spinner while the method is in flight. */
  busy?: boolean;
};

/**
 * One row of the sign-in list: icon, label, and either a chevron or the
 * "Last used" hint. Every method renders through this so the list reads as
 * one even set — no method is visually promoted over another.
 */
export function SignInMethodButton({
  icon,
  children,
  isLastUsed = false,
  busy = false,
  className,
  type = 'button',
  ...props
}: SignInMethodButtonProps) {
  return (
    <button type={type} className={cn(s.row, className)} aria-busy={busy || undefined} {...props}>
      <span className={s.icon}>{busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}</span>
      <span className={s.label}>{children}</span>
      {isLastUsed ? (
        <span className={s.badge}>Last used</span>
      ) : (
        <ChevronRight size={15} className={s.chevron} aria-hidden="true" />
      )}
    </button>
  );
}
