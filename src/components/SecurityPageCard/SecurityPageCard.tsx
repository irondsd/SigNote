import { type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import s from './SecurityPageCard.module.scss';

type SecurityPageCardProps = {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  size?: 'default' | 'wide';
  tone?: 'default' | 'success';
};

export function SecurityPageCard({ icon, title, children, size = 'default', tone = 'default' }: SecurityPageCardProps) {
  return (
    <div className={s.container}>
      <div className={cn(s.card, size === 'wide' && s.wide)}>
        <div className={cn(s.iconWrap, tone === 'success' && s.successIcon)}>{icon}</div>
        <h2 className={s.heading}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
