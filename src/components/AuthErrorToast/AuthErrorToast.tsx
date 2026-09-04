'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

const MESSAGES: Record<string, string> = {
  email_taken:
    'That Google account uses an email address that already signs into a different SigNote account, and Google has not verified it. Sign in with a code sent to that address instead.',
};

/**
 * Surfaces the `?auth_error=` a failed sign-in redirects back with. NextAuth's
 * own error page can't explain any of this, and a bare "access denied" for a
 * refusal this specific is worse than no message.
 */
export function AuthErrorToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const error = searchParams.get('auth_error');
    if (!error) return;

    toast.error(MESSAGES[error] ?? 'Could not sign you in. Please try again.', { duration: 10000 });

    const url = new URL(window.location.href);
    url.searchParams.delete('auth_error');
    router.replace(url.pathname + (url.search || ''), { scroll: false });
  }, [searchParams, router]);

  return null;
}
