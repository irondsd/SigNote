'use client';

import dynamic from 'next/dynamic';

// Client-only: the list reaches wagmi through `useSiweSign`.
const SignInMethodsList = dynamic(
  () => import('./SignInMethodsList').then((module) => module.SignInMethodsList),
  { ssr: false },
);

export function SignInMethods() {
  return <SignInMethodsList />;
}
