'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';

export function PostHogIdentify() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      posthog.identify(session.user.id, {
        name: session.user.name ?? undefined,
      });
    } else if (status === 'unauthenticated') {
      posthog.reset();
    }
  }, [status, session?.user?.id, session?.user?.name]);

  return null;
}
