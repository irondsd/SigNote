import type { Metadata } from 'next';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo/Logo';
import { describeAuthError } from '@/lib/authErrors';
import s from './page.module.scss';

export const metadata: Metadata = {
  title: 'Sign-in error',
  robots: { index: false, follow: false },
};

/**
 * Where every failed sign-in lands: NextAuth redirects here via
 * `pages.error` in `config/auth.ts`, and so do our own refusals.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { title, description, code } = describeAuthError((await searchParams).error);

  return (
    <main className={s.screen}>
      <div className={s.content}>
        <Logo className={s.logo} />

        <Card className={s.card} role="alert" data-testid="auth-error">
          <CardHeader className={s.header}>
            <div className={s.mark} aria-hidden="true">
              <TriangleAlert size={24} />
            </div>
            <CardTitle className={s.title}>{title}</CardTitle>
            <CardDescription className={s.description}>{description}</CardDescription>
          </CardHeader>

          <CardContent className={s.body}>
            <Button asChild className={s.primaryAction}>
              <Link href="/">Back to sign in</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/support">Contact support</Link>
            </Button>
          </CardContent>
        </Card>

        {code && (
          <p className={s.code}>
            Error code: <code>{code}</code>
          </p>
        )}
      </div>
    </main>
  );
}
