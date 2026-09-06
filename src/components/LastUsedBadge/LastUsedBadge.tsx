import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/utils/cn';
import s from './LastUsedBadge.module.scss';

type SignInMethodButtonContentProps = {
  icon: ReactNode;
  children: ReactNode;
  isLastUsed: boolean;
};

export function SignInMethodButtonContent({ icon, children, isLastUsed }: SignInMethodButtonContentProps) {
  return (
    <span className={s.content}>
      <span className={s.icon}>{icon}</span>
      <span className={cn(s.label, isLastUsed && s.labelWithBadge)}>{children}</span>
      {isLastUsed && (
        <Badge variant="outline" className={s.badge}>
          Last used
        </Badge>
      )}
    </span>
  );
}
