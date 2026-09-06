'use client';

import { useEffect, useState } from 'react';
import { getLastSignInMethod, type SignInMethod } from '@/lib/lastSignInMethod';

export function useLastSignInMethod(): SignInMethod | null {
  const [method, setMethod] = useState<SignInMethod | null>(null);

  useEffect(() => {
    // Reading after mount keeps the server and first client render identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is a client-only external store
    setMethod(getLastSignInMethod());
  }, []);

  return method;
}
