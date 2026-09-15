import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
 * Where every failed sign-in lands: NextAuth redirects here via both
 * `pages.error` and `pages.signIn` in `config/auth.ts`, and so do our own
 * refusals. Reached with no error at all — NextAuth's sign-in page opened
 * directly — there is nothing to report, so it goes back to the app.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error } = await searchParams;
  if (!error) redirect('/');
  const { title, description, code } = describeAuthError(error);

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
