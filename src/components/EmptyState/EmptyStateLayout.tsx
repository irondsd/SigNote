import type { ReactNode } from 'react';
import s from './EmptyState.module.scss';

type EmptyStateLayoutProps = {
  icon: ReactNode;
  heading: string;
  sub: string;
  action?: ReactNode;
};

export function EmptyStateLayout({ icon, heading, sub, action }: EmptyStateLayoutProps) {
  return (
    <div className={s.container}>
      <div className={s.icon}>{icon}</div>
      <h3 className={s.heading}>{heading}</h3>
      <p className={s.sub}>{sub}</p>
      {action}
    </div>
  );
}
