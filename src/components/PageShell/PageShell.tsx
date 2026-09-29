import type { ReactNode } from 'react';
import s from './PageShell.module.scss';

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

export function PageShell({ children, className }: PageShellProps) {
  return <div className={className ? `${s.page} ${className}` : s.page}>{children}</div>;
}

export function PageLoading() {
  return (
    <div className={s.loading}>
      <span className={s.spinner} />
    </div>
  );
}
