import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DesktopLogin } from './DesktopLogin';
import s from './page.module.scss';

export const metadata: Metadata = {
  title: 'Authorize SigNote Desktop',
  robots: { index: false, follow: false },
};

export default function DesktopLoginPage() {
  return (
    <main className={s.screen}>
      <Suspense fallback={<div className={s.loadingCard} aria-label="Loading desktop authorization" />}>
        <DesktopLogin />
      </Suspense>
    </main>
  );
}
